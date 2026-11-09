/* LID core: latency-insensitive protocol simulator (one-stop-to-stall backpressure)
   Conventions (match CSEE4868 HW3 / Lecture 12):
   - Every shell output and every stop signal is clocked (values at n come from state).
   - A shell fires at n iff every input channel has a token available (queue head, or
     bypass of the token arriving at n) AND no valid output token is being stopped at n.
   - If a valid output token is stopped at n, it is repeated at n+1 with void=0.
     Otherwise, if the shell stalls at n, outputs at n+1 repeat with void=1.
   - stopOut of a shell input at n = 1 iff the residual queue (tokens left over from n-1)
     is already full; the token arriving at n is then rejected and the sender repeats it at n+1.
   - Queue column at n shows the tokens stored at n *before* this cycle's pop, i.e. residual
     tokens plus the token arriving at n if it was accepted and not bypassed.
     (A token that arrives when the queue is empty and the shell fires is bypassed: never stored.)
   - Relay station: 2-state FSM (processing / stalling), main + aux FF, init void.
     Optimizations from Lecture 12: a stop received while emitting a void is ignored;
     a void arriving together with a stop is discarded (output repeated).
   - "-" is a valid token of unknown value; arithmetic on it yields "-".
*/
(function (root) {
'use strict';

const INF = Infinity;
const isNil = (v) => v === null || v === undefined;

/* ---------- expression parser ---------- */
function tokenize(src) {
  const toks = []; let i = 0;
  const two = ['==', '!=', '<=', '>=', '&&', '||'];
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (/[0-9.]/.test(c)) { let j = i; while (j < src.length && /[0-9.]/.test(src[j])) j++; toks.push({ t: 'num', v: parseFloat(src.slice(i, j)) }); i = j; continue; }
    if (/[A-Za-z_]/.test(c)) { let j = i; while (j < src.length && /[A-Za-z0-9_]/.test(src[j])) j++; toks.push({ t: 'id', v: src.slice(i, j) }); i = j; continue; }
    const p = src.slice(i, i + 2);
    if (two.includes(p)) { toks.push({ t: 'op', v: p }); i += 2; continue; }
    if ('+-*/%<>!?:()'.includes(c)) { toks.push({ t: 'op', v: c }); i++; continue; }
    throw new Error('Unexpected character "' + c + '" in expression "' + src + '"');
  }
  return toks;
}
function parseExpr(src) {
  const toks = tokenize(src); let p = 0;
  const peek = () => toks[p]; const next = () => toks[p++];
  const isOp = (v) => peek() && peek().t === 'op' && peek().v === v;
  function primary() {
    const tk = next();
    if (!tk) throw new Error('Unexpected end of expression "' + src + '"');
    if (tk.t === 'num') return { k: 'num', v: tk.v };
    if (tk.t === 'id') return { k: 'id', v: tk.v };
    if (tk.v === '(') { const e = ternary(); if (!isOp(')')) throw new Error('Missing ) in "' + src + '"'); next(); return e; }
    if (tk.v === '-') return { k: 'neg', a: unary() };
    if (tk.v === '!') return { k: 'not', a: unary() };
    throw new Error('Unexpected token "' + tk.v + '" in "' + src + '"');
  }
  function unary() { return primary(); }
  function binary(level) {
    const levels = [['||'], ['&&'], ['==', '!='], ['<', '<=', '>', '>='], ['+', '-'], ['*', '/', '%']];
    if (level >= levels.length) return unary();
    let left = binary(level + 1);
    while (peek() && peek().t === 'op' && levels[level].includes(peek().v)) { const op = next().v; const right = binary(level + 1); left = { k: 'bin', op, a: left, b: right }; }
    return left;
  }
  function ternary() {
    const c = binary(0);
    if (isOp('?')) { next(); const a = ternary(); if (!isOp(':')) throw new Error('Missing : in "' + src + '"'); next(); const b = ternary(); return { k: 'tern', c, a, b }; }
    return c;
  }
  const ast = ternary();
  if (p < toks.length) throw new Error('Trailing input in expression "' + src + '"');
  return ast;
}
function evalAst(ast, env) {
  switch (ast.k) {
    case 'num': return ast.v;
    case 'id': if (!(ast.v in env)) throw new Error('Unknown signal "' + ast.v + '"'); return env[ast.v];
    case 'neg': { const a = evalAst(ast.a, env); return isNil(a) ? null : -a; }
    case 'not': { const a = evalAst(ast.a, env); return isNil(a) ? null : (a ? 0 : 1); }
    case 'tern': { const c = evalAst(ast.c, env); if (isNil(c)) return null; return c ? evalAst(ast.a, env) : evalAst(ast.b, env); }
    case 'bin': {
      const a = evalAst(ast.a, env), b = evalAst(ast.b, env);
      if (isNil(a) || isNil(b)) return null;
      switch (ast.op) {
        case '+': return a + b; case '-': return a - b; case '*': return a * b;
        case '/': return b === 0 ? null : Math.trunc(a / b); case '%': return b === 0 ? null : a % b;
        case '==': return a === b ? 1 : 0; case '!=': return a !== b ? 1 : 0;
        case '<': return a < b ? 1 : 0; case '<=': return a <= b ? 1 : 0; case '>': return a > b ? 1 : 0; case '>=': return a >= b ? 1 : 0;
        case '&&': return (a && b) ? 1 : 0; case '||': return (a || b) ? 1 : 0;
      }
    }
  }
  throw new Error('bad ast');
}
function identsOf(ast, out = new Set()) {
  if (!ast) return out;
  if (ast.k === 'id') out.add(ast.v);
  ['a', 'b', 'c'].forEach(k => ast[k] && identsOf(ast[k], out));
  return out;
}

/* ---------- spec text parser ----------
Format (one statement per line, '#' comments):
  cycles 15
  queue 2            (or: queue inf)      default capacity for all shells
  shell S1 [queue N]
    in x              primary input
    in p <- S0.q [rs K]   channel from register q of shell S0, with K relay stations
    reg a = x + y init 2
    out m             (registers that are visible outside the shell; auto-added if referenced)
  output m = S1.m     primary output taken from register m of S1 (name may differ)
  x: 3 2 2v 1 4 5 8 9 7 6 - - - - -        per-cycle intended input trace; "v" suffix = void
                                            token, plain "v" = void repeating the previous value
  stop m: 0 0 0 0 0 1 0 0 0 1 1 0 0 0 0   stop asserted by the environment on primary output m
*/
function fmtVal(v) { return isNil(v) ? '-' : String(v); }
function parseVal(s) { s = String(s).trim(); if (s === '' || s === '-' || s === '−' || s === '—' || s.toLowerCase() === 'x') return null; const n = Number(s); if (Number.isNaN(n)) throw new Error('Bad value "' + s + '"'); return n; }

function parseSpec(text) {
  const spec = { cycles: 12, queueCap: 2, shells: [], outputs: [], inputs: {}, stops: {} };
  let cur = null;
  const lines = text.split(/\r?\n/);
  lines.forEach((raw, li) => {
    const line = raw.replace(/#.*$/, '').trim(); if (!line) return;
    const err = (m) => { throw new Error('Line ' + (li + 1) + ': ' + m); };
    let m;
    if ((m = line.match(/^cycles\s+(\d+)$/i))) { spec.cycles = +m[1]; return; }
    if ((m = line.match(/^queue\s+(\S+)$/i))) { spec.queueCap = /^inf/i.test(m[1]) ? INF : +m[1]; return; }
    if ((m = line.match(/^shell\s+([A-Za-z_]\w*)(?:\s+queue\s+(\S+))?$/i))) {
      cur = { name: m[1], inputs: [], regs: [], outs: [], queueCap: m[2] ? (/^inf/i.test(m[2]) ? INF : +m[2]) : null };
      spec.shells.push(cur); return;
    }
    if ((m = line.match(/^in\s+([A-Za-z_]\w*)(?:\s*<-\s*([A-Za-z_]\w*)\.([A-Za-z_]\w*)(?:\s+rs\s+(\d+))?)?$/i))) {
      if (!cur) err('"in" outside of a shell');
      cur.inputs.push({ name: m[1], from: m[2] ? { shell: m[2], reg: m[3] } : null, rs: m[4] ? +m[4] : 0 }); return;
    }
    if ((m = line.match(/^reg\s+([A-Za-z_]\w*)\s*=\s*(.+?)\s+init\s+(\S+)$/i))) {
      if (!cur) err('"reg" outside of a shell');
      cur.regs.push({ name: m[1], expr: m[2].trim(), ast: parseExpr(m[2].trim()), init: parseVal(m[3]) }); return;
    }
    if ((m = line.match(/^reg\s+([A-Za-z_]\w*)\s*=\s*(.+)$/i))) {
      if (!cur) err('"reg" outside of a shell');
      cur.regs.push({ name: m[1], expr: m[2].trim(), ast: parseExpr(m[2].trim()), init: null }); return;
    }
    if ((m = line.match(/^out\s+(.+)$/i))) { if (!cur) err('"out" outside of a shell'); m[1].split(/[\s,]+/).filter(Boolean).forEach(r => cur.outs.push(r)); return; }
    if ((m = line.match(/^output\s+([A-Za-z_]\w*)\s*=\s*([A-Za-z_]\w*)\.([A-Za-z_]\w*)$/i))) { spec.outputs.push({ name: m[1], from: { shell: m[2], reg: m[3] } }); return; }
    if ((m = line.match(/^stop\s+([A-Za-z_]\w*)\s*:\s*(.*)$/i))) { spec.stops[m[1]] = m[2].split(/[\s,]+/).filter(Boolean).map(b => (b === '1' ? 1 : 0)); return; }
    if ((m = line.match(/^([A-Za-z_]\w*)\s*:\s*(.*)$/))) {
      const toks = m[2].split(/[\s,]+/).filter(Boolean); const trace = []; let prev = null;
      toks.forEach(t => {
        let v = 0, d;
        if (/v$/i.test(t)) { v = 1; const body = t.slice(0, -1); d = body === '' ? prev : parseVal(body); }
        else d = parseVal(t);
        trace.push({ d, v }); if (!v) prev = d;
      });
      spec.inputs[m[1]] = trace; return;
    }
    err('Cannot parse "' + line + '"');
  });
  return spec;
}

function specToText(spec) {
  const L = [];
  L.push('cycles ' + spec.cycles);
  L.push('queue ' + (spec.queueCap === INF ? 'inf' : spec.queueCap));
  spec.shells.forEach(sh => {
    L.push('');
    L.push('shell ' + sh.name + (sh.queueCap != null ? ' queue ' + (sh.queueCap === INF ? 'inf' : sh.queueCap) : ''));
    sh.inputs.forEach(i => L.push('  in ' + i.name + (i.from ? ' <- ' + i.from.shell + '.' + i.from.reg + (i.rs ? ' rs ' + i.rs : '') : '')));
    sh.regs.forEach(r => L.push('  reg ' + r.name + ' = ' + r.expr + ' init ' + fmtVal(r.init)));
    if (sh.outs.length) L.push('  out ' + sh.outs.join(' '));
  });
  L.push('');
  spec.outputs.forEach(o => L.push('output ' + o.name + ' = ' + o.from.shell + '.' + o.from.reg));
  L.push('');
  Object.keys(spec.inputs).forEach(k => L.push(k + ': ' + spec.inputs[k].map(t => fmtVal(t.d) + (t.v ? 'v' : '')).join(' ')));
  Object.keys(spec.stops).forEach(k => L.push('stop ' + k + ': ' + spec.stops[k].join(' ')));
  return L.join('\n');
}

/* ---------- elaboration ---------- */
function elaborate(spec) {
  const shells = spec.shells.map(sh => ({ ...sh, regs: sh.regs.map(r => ({ ...r, ast: r.ast || parseExpr(r.expr) })), outs: [...sh.outs] }));
  const byName = {}; shells.forEach(s => { if (byName[s.name]) throw new Error('Duplicate shell ' + s.name); byName[s.name] = s; });
  const primaryInputs = []; const channels = []; // channel: {src:{shell,reg}, dst:{kind:'shell',shell,input}|{kind:'env',name}, rs:K, id}
  shells.forEach(sh => {
    const names = new Set();
    sh.inputs.forEach(i => { if (names.has(i.name)) throw new Error('Shell ' + sh.name + ': duplicate signal ' + i.name); names.add(i.name); });
    sh.regs.forEach(r => { if (names.has(r.name)) throw new Error('Shell ' + sh.name + ': duplicate signal ' + r.name); names.add(r.name); });
    sh.regs.forEach(r => identsOf(r.ast).forEach(id => { if (!names.has(id)) throw new Error('Shell ' + sh.name + ': register ' + r.name + ' uses unknown signal "' + id + '"'); }));
    sh.inputs.forEach(i => {
      if (!i.from) { if (!primaryInputs.find(p => p.name === i.name)) primaryInputs.push({ name: i.name }); return; }
      const src = byName[i.from.shell]; if (!src) throw new Error('Shell ' + sh.name + ': input ' + i.name + ' refers to unknown shell ' + i.from.shell);
      if (!src.regs.find(r => r.name === i.from.reg)) throw new Error('Shell ' + sh.name + ': input ' + i.name + ' refers to unknown register ' + i.from.shell + '.' + i.from.reg);
      if (!src.outs.includes(i.from.reg)) src.outs.push(i.from.reg);
      channels.push({ src: { shell: src.name, reg: i.from.reg }, dst: { kind: 'shell', shell: sh.name, input: i.name }, rs: i.rs || 0 });
    });
  });
  spec.outputs.forEach(o => {
    const src = byName[o.from.shell]; if (!src) throw new Error('Output ' + o.name + ' refers to unknown shell ' + o.from.shell);
    if (!src.regs.find(r => r.name === o.from.reg)) throw new Error('Output ' + o.name + ' refers to unknown register ' + o.from.shell + '.' + o.from.reg);
    if (!src.outs.includes(o.from.reg)) src.outs.push(o.from.reg);
    channels.push({ src: { shell: src.name, reg: o.from.reg }, dst: { kind: 'env', name: o.name }, rs: 0 });
  });
  // primary inputs shared by several shells: each (shell,input) gets its own channel from env
  channels.forEach((c, i) => { c.id = i; c.label = c.src.shell + '.' + c.src.reg + '→' + (c.dst.kind === 'env' ? c.dst.name : c.dst.shell + '.' + c.dst.input); });
  primaryInputs.forEach(p => { if (!spec.inputs[p.name]) throw new Error('No input trace given for primary input ' + p.name); });
  spec.outputs.forEach(o => { if (!spec.stops[o.name]) spec.stops[o.name] = []; });
  return { spec, shells, byName, primaryInputs, channels };
}

/* ---------- simulation ---------- */
function simulate(spec) {
  const E = elaborate(spec);
  const N = spec.cycles;
  const shells = E.shells; const channels = E.channels;
  const cap = (sh) => (sh.queueCap != null ? sh.queueCap : spec.queueCap);

  // state
  const st = {};
  shells.forEach(sh => {
    st[sh.name] = { regs: {}, void: {}, queues: {} }; // void is kept PER OUTPUT CHANNEL (keyed by channel id)
    sh.regs.forEach(r => { st[sh.name].regs[r.name] = r.init; });
    channels.filter(c => c.src.shell === sh.name).forEach(c => { st[sh.name].void[c.id] = 0; });
    sh.inputs.forEach(i => { st[sh.name].queues[i.name] = []; });
  });
  const rsState = {}; // key ch.id+'/'+k  -> {d,v,aux,stalling}
  channels.forEach(ch => { for (let k = 1; k <= ch.rs; k++) rsState[ch.id + '/' + k] = { d: null, v: 1, aux: null, stalling: false }; });
  const env = {}; E.primaryInputs.forEach(p => { env[p.name] = { stream: spec.inputs[p.name], idx: 0, repeat: null }; });

  const rows = []; // row[n] = { inputs:{name:{d,v,s}}, shells:{name:{queues:{in:[..]}, regs:{}, void:{}, stops:{in:0/1}, fired, reason, events}}, segs:{chid/k:{d,v,s}} }
  const expl = []; // free text per cycle

  for (let n = 1; n <= N; n++) {
    const row = { n, inputs: {}, shells: {}, segs: {}, rsEvents: {}, notes: [] };
    // 1. presented primary inputs
    const presented = {};
    E.primaryInputs.forEach(p => {
      const e = env[p.name]; let tok, how;
      if (e.repeat) { tok = { ...e.repeat }; how = 'repeat'; if (e.idx < e.stream.length && e.stream[e.idx].v) e.idx++; /* bubble absorbed */ }
      else if (e.idx < e.stream.length) { tok = { ...e.stream[e.idx] }; e.idx++; how = 'stream'; }
      else { tok = { d: null, v: 1 }; how = 'end'; }
      presented[p.name] = tok; row.inputs[p.name] = { d: tok.d, v: tok.v, s: 0, how };
    });
    // 2. tokens on each channel segment at n, and stop seen by each segment's sender
    //    segment k (0..rs): sender = shell output (k=0) or RS k; receiver = RS k+1 or destination
    const segTok = {}; const segStop = {};
    channels.forEach(ch => {
      const S = st[ch.src.shell];
      segTok[ch.id + '/0'] = { d: S.regs[ch.src.reg], v: S.void[ch.id] };
      for (let k = 1; k <= ch.rs; k++) { const r = rsState[ch.id + '/' + k]; segTok[ch.id + '/' + k] = { d: r.d, v: r.v }; }
      // stop seen by sender of segment k = stopOut of RS k+1, or of destination
      let dstStop;
      if (ch.dst.kind === 'env') dstStop = (spec.stops[ch.dst.name][n - 1] || 0);
      else { const D = st[ch.dst.shell]; const q = D.queues[ch.dst.input]; dstStop = q.length >= cap(E.byName[ch.dst.shell]) ? 1 : 0; }
      for (let k = 0; k <= ch.rs; k++) segStop[ch.id + '/' + k] = (k < ch.rs) ? (rsState[ch.id + '/' + (k + 1)].stalling ? 1 : 0) : dstStop;
    });
    // primary inputs: stop seen by env = destination queue full (an input shared by several shells sees the OR)
    const inStop = {}; const inStopBy = {};
    shells.forEach(sh => sh.inputs.forEach(i => { if (!i.from) { const q = st[sh.name].queues[i.name]; const s = q.length >= cap(sh) ? 1 : 0; inStop[i.name] = (inStop[i.name] || 0) | s; if (s) (inStopBy[i.name] = inStopBy[i.name] || []).push(sh.name); } }));
    E.primaryInputs.forEach(p => { row.inputs[p.name].s = inStop[p.name] || 0; });

    // 3. shells
    const nextRegs = {}; const nextVoid = {};
    shells.forEach(sh => {
      const S = st[sh.name]; const C = cap(sh);
      const rec = { queues: {}, regs: { ...S.regs }, chVoid: { ...S.void }, chStops: {}, stops: {}, inEvents: {}, outStops: {}, fired: false, reason: '', inputsUsed: {} };
      // tokens arriving at each input
      const arriving = {};
      sh.inputs.forEach(i => {
        let tok, stop;
        if (!i.from) { tok = presented[i.name]; stop = st[sh.name].queues[i.name].length >= C ? 1 : 0; }
        else { const ch = channels.find(c => c.dst.kind === 'shell' && c.dst.shell === sh.name && c.dst.input === i.name); tok = segTok[ch.id + '/' + ch.rs]; stop = segStop[ch.id + '/' + ch.rs]; }
        arriving[i.name] = tok; rec.stops[i.name] = stop;
        const q = S.queues[i.name];
        rec.queues[i.name] = { residual: [...q], arriving: tok, stopped: stop };
        if (!tok.v && !stop) { q.push(tok.d); rec.inEvents[i.name] = 'accepted'; }
        else if (!tok.v && stop) rec.inEvents[i.name] = 'rejected';
        else rec.inEvents[i.name] = 'void';
      });
      // output back-pressure
      const blockedOuts = []; const myChannels = channels.filter(c => c.src.shell === sh.name);
      myChannels.forEach(c => { rec.chStops[c.id] = segStop[c.id + '/0']; });
      sh.outs.forEach(o => {
        const blocked = myChannels.filter(c => c.src.reg === o && segStop[c.id + '/0'] && !S.void[c.id]);
        rec.outStops[o] = myChannels.some(c => c.src.reg === o && segStop[c.id + '/0']) ? 1 : 0;
        if (blocked.length) blockedOuts.push(o);
      });
      const missing = sh.inputs.filter(i => S.queues[i.name].length === 0).map(i => i.name);
      // queue display: stored at n before pop (residual + accepted arrival), but a bypassed token is not "stored"
      const fire = missing.length === 0 && blockedOuts.length === 0;
      sh.inputs.forEach(i => {
        const q = S.queues[i.name]; const info = rec.queues[i.name];
        const bypass = fire && info.residual.length === 0 && rec.inEvents[i.name] === 'accepted';
        info.shown = bypass ? [] : [...q]; info.bypass = bypass;
      });
      rec.fired = fire;
      if (fire) {
        const envv = { ...S.regs };
        sh.inputs.forEach(i => { envv[i.name] = S.queues[i.name].shift(); rec.inputsUsed[i.name] = envv[i.name]; });
        const nr = {}; sh.regs.forEach(r => { nr[r.name] = evalAst(r.ast, envv); });
        nextRegs[sh.name] = nr; nextVoid[sh.name] = {}; myChannels.forEach(c => { nextVoid[sh.name][c.id] = 0; });
        rec.reason = 'fires: every input channel has a token available (' + sh.inputs.map(i => i.name + '=' + fmtVal(envv[i.name])).join(', ') + ') and no valid output is stopped';
      } else {
        nextRegs[sh.name] = { ...S.regs }; nextVoid[sh.name] = {};
        // per channel: a stopped valid token is repeated as valid; a token already sampled is repeated as void
        myChannels.forEach(c => { nextVoid[sh.name][c.id] = (segStop[c.id + '/0'] && !S.void[c.id]) ? 0 : 1; });
        const parts = [];
        if (missing.length) parts.push('no token available on input ' + missing.map(m => m + ' (' + (arriving[m].v ? 'void token arrives' : 'token rejected') + ' and queue empty)').join(', '));
        if (blockedOuts.length) parts.push('valid output token ' + blockedOuts.map(o => o + '=' + fmtVal(S.regs[o])).join(', ') + ' is stopped by its receiver (stop=1)');
        rec.reason = 'stalls: ' + parts.join('; ');
      }
      sh.inputs.forEach(i => { rec.queues[i.name].after = [...S.queues[i.name]]; });
      row.shells[sh.name] = rec;
    });
    // record segments at n
    channels.forEach(ch => { for (let k = 0; k <= ch.rs; k++) { const t = segTok[ch.id + '/' + k]; row.segs[ch.id + '/' + k] = { d: t.d, v: t.v, s: segStop[ch.id + '/' + k] }; } });
    // 4. relay stations next state
    const nextRs = {};
    channels.forEach(ch => {
      for (let k = 1; k <= ch.rs; k++) {
        const r = rsState[ch.id + '/' + k]; const inTok = segTok[ch.id + '/' + (k - 1)]; const stopIn = segStop[ch.id + '/' + k];
        const nx = { ...r }; let ev;
        if (!r.stalling) {
          if (stopIn && !r.v) {
            if (inTok.v) { ev = 'stopped while holding valid ' + fmtVal(r.d) + '; incoming token is void so it is discarded and the output is simply repeated'; }
            else { nx.aux = inTok.d; nx.stalling = true; ev = 'stopped while holding valid ' + fmtVal(r.d) + ': buffers incoming ' + fmtVal(inTok.d) + ' in the auxiliary FF, repeats output and raises stopOut at n+1'; }
          } else {
            nx.d = inTok.d; nx.v = inTok.v;
            ev = stopIn ? 'stop received but the current output is void, so it is ignored: relays incoming ' + (inTok.v ? 'void' : 'valid ' + fmtVal(inTok.d)) + ' token'
                        : 'relays incoming ' + (inTok.v ? 'void' : 'valid ' + fmtVal(inTok.d)) + ' token (output at n+1)';
          }
        } else {
          if (stopIn) { ev = 'still stopped: keeps both tokens (' + fmtVal(r.d) + ' main, ' + fmtVal(r.aux) + ' aux), stopOut stays 1; the token arriving now is rejected'; }
          else { nx.d = r.aux; nx.v = 0; nx.aux = null; nx.stalling = false; ev = 'stop released: moves ' + fmtVal(r.aux) + ' from aux to main FF, stopOut drops at n+1; the token arriving now is rejected (sender repeats it)'; }
        }
        nextRs[ch.id + '/' + k] = nx; row.rsEvents[ch.id + '/' + k] = ev;
      }
    });
    // 5. environment repeat
    E.primaryInputs.forEach(p => { const t = presented[p.name]; env[p.name].repeat = (!t.v && (inStop[p.name] || 0)) ? { d: t.d, v: 0 } : null; });
    // commit
    shells.forEach(sh => { st[sh.name].regs = nextRegs[sh.name]; st[sh.name].void = nextVoid[sh.name]; });
    Object.assign(rsState, nextRs);
    rows.push(row);
  }
  return { E, rows };
}

/* ---------- strict (synchronous) reference simulation ----------
   Same cores, zero-latency channels, no voids: input i receives the k-th valid token of its stream at cycle k. */
function simulateStrict(spec, cycles) {
  const E = elaborate(spec); const N = cycles || spec.cycles; const shells = E.shells;
  const regs = {}; shells.forEach(sh => { regs[sh.name] = {}; sh.regs.forEach(r => regs[sh.name][r.name] = r.init); });
  const streams = {}; E.primaryInputs.forEach(p => { streams[p.name] = spec.inputs[p.name].filter(t => !t.v).map(t => t.d); });
  const rows = [];
  for (let n = 1; n <= N; n++) {
    const inp = {}; E.primaryInputs.forEach(p => { inp[p.name] = n - 1 < streams[p.name].length ? streams[p.name][n - 1] : null; });
    const row = { n, inputs: { ...inp }, regs: {} }; shells.forEach(sh => row.regs[sh.name] = { ...regs[sh.name] });
    const next = {};
    shells.forEach(sh => {
      const envv = { ...regs[sh.name] };
      sh.inputs.forEach(i => { envv[i.name] = i.from ? regs[i.from.shell][i.from.reg] : inp[i.name]; });
      next[sh.name] = {}; sh.regs.forEach(r => next[sh.name][r.name] = evalAst(r.ast, envv));
    });
    Object.assign(regs, next); rows.push(row);
  }
  return { E, rows };
}

/* ---------- helpers for the UI ---------- */
function throughputInfo(spec) {
  // cycle means s/(s+r) over simple cycles of the shell graph (shells = nodes, channels = edges with rs count)
  const E = elaborate(spec); const names = E.shells.map(s => s.name); const idx = {}; names.forEach((n, i) => idx[n] = i);
  const edges = E.channels.filter(c => c.dst.kind === 'shell').map(c => ({ a: idx[c.src.shell], b: idx[c.dst.shell], rs: c.rs }));
  const cycles = []; const n = names.length;
  // simple DFS cycle enumeration (small graphs)
  function dfs(start, cur, visited, path, rsSum) {
    edges.filter(e => e.a === cur).forEach(e => {
      if (e.b === start) cycles.push({ shells: [...path], rs: rsSum + e.rs });
      else if (e.b > start && !visited.has(e.b)) { visited.add(e.b); path.push(e.b); dfs(start, e.b, visited, path, rsSum + e.rs); path.pop(); visited.delete(e.b); }
    });
  }
  for (let s = 0; s < n; s++) dfs(s, s, new Set([s]), [s], 0);
  const list = cycles.map(c => ({ path: c.shells.map(i => names[i]), s: c.shells.length, r: c.rs, mean: c.shells.length / (c.shells.length + c.rs) }));
  const mst = list.length ? Math.min(1, ...list.map(c => c.mean)) : 1;
  return { cycles: list, mst };
}

const api = { parseExpr, evalAst, parseSpec, specToText, elaborate, simulate, simulateStrict, throughputInfo, fmtVal, parseVal, INF };
if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.LID = api;
})(typeof window !== 'undefined' ? window : globalThis);
