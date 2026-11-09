(function () {
'use strict';
const $ = (s) => document.querySelector(s);
const INF = LID.INF; const fmt = LID.fmtVal;

/* ---------- examples ---------- */
const HW3 = (q, stops) => `cycles 15
queue ${q}

shell S
  in x
  in y
  in w
  reg a = x + y init 2
  reg z = w init 2
  reg m = a * z init -

output m = S.m

x: 3 2 2v 1 4 5 8 9 7 6 - - - - -
y: 3 5 2 7 2 8 4 4v 0 1 - - - - -
w: 3 2 4 1 5 5v 6 0 7 8 - - - - -
stop m: ${stops}`;
const EXAMPLES = {
  macslide: `# Lecture 12, slides 6-9: variation of a MAC, LID implementation with backpressure, queues of size 2.
# Inputs are the strict streams of slide 7; x carries a void bubble (9) at n = 2 as in the slide;
# the environment stops output a at n = 5 and 6. Tokens rejected by a stop are repeated automatically.
# After the data, the environment keeps sending valid tokens of unknown value (-), the HW3 convention.
cycles 14
queue 2

shell Mult
  in x
  in y
  reg m = x * y init 0

shell Add
  in m <- Mult.m
  in c <- Mux.c
  reg a = c + m init 0

shell Mux
  in a <- Add.a
  in w
  in z
  reg c = z ? w : a init 0

output a = Add.a

x: 2 9v 1 5 8 4 6 7 3 2 - - - -
y: 2 3 4 1 5 6 7 8 2 - - - - -
w: 0 1 2 3 4 10 5 6 7 - - - - -
z: 0 0 0 0 0 1 0 0 0 - - - - -
stop a: 0 0 0 0 1 1 0 0 0 0 0 0 0 0`,
  hw3b: HW3('inf', '0 0 0 0 0 0 0 0 0 0 0 0 0 0 0'),
  hw3c: HW3('inf', '0 0 0 0 0 1 0 0 0 1 1 0 0 0 0'),
  hw3d: HW3('2', '0 0 0 0 0 0 0 0 0 0 0 0 0 0 0'),
  hw3e: HW3('2', '0 0 0 0 0 1 0 0 0 1 1 0 0 0 0'),
  mac: `# Variation of a MAC (Lecture 12): multiplier, accumulator adder, preset multiplexer.
# c is the accumulator register, preset to w when z = 1; a returns alternate partial sums.
cycles 12
queue 2

shell Mult
  in x
  in y
  reg p = x * y init 0

shell Add
  in p <- Mult.p
  in c <- Mux.c
  reg a = p + c init 0

shell Mux
  in a <- Add.a
  in w
  in z
  reg c = z ? w : a init 0

output a = Add.a

x: 2 3 3v 1 4 2 5 1 3 2 1 4
y: 1 2 2 3 1v 1 2 2 1 3 2 1
w: 0 0 0 5 0 0 0 0 9 0 0 0
z: 0 0 0 1 0 0 0 0 1 0 0 0
stop a: 0 0 0 0 0 1 0 0 0 0 1 0`,
  pipe: `# Two shells; the long wire between them is pipelined with one relay station.
cycles 12
queue 2

shell A
  in x
  reg p = x + 1 init 0

shell B
  in p <- A.p rs 1
  in y
  reg q = p * y init 0

output q = B.q

x: 1 2 3 3v 4 5 6 7 8 9 10 11
y: 2 1 1v 3 2 2 1 3 1 2 1 1
stop q: 0 0 0 0 0 1 1 0 0 0 0 0`,
  loop: `# Feedback loop A -> B -> RS -> A: two shells and one relay station on the cycle,
# so the maximum sustainable throughput is 2/3 even with a perfect environment.
cycles 12
queue 2

shell A
  in x
  in f <- B.g rs 1
  reg u = x + f init 0

shell B
  in u <- A.u
  reg g = u % 10 init 1

output y = B.g

x: 1 2 3 4 5 6 7 8 9 10 11 12
stop y: 0 0 0 0 0 0 0 1 0 0 0 0`,
  fork: `# Reconvergent paths: C needs A's token both directly and through B (via a relay station),
# so the direct branch must wait in C's queue.
cycles 12
queue 2

shell A
  in x
  reg p = x + 1 init 0

shell B
  in p <- A.p rs 1
  reg q = p * 2 init 0

shell C
  in p <- A.p
  in q <- B.q
  reg r = p + q init 0

output r = C.r

x: 1 2 3 3v 4 5 6 7 8 9 10 11
stop r: 0 0 0 0 0 0 1 0 0 0 0 0`
};

/* ---------- state ---------- */
let spec = null, sim = null, strictSim = null, cells = [], answers = {};

/* ---------- tabs ---------- */
function selectTab(tab) {
  document.querySelectorAll('.tabs button').forEach(x => x.setAttribute('aria-selected', x.dataset.tab === tab ? 'true' : 'false'));
  const anim = tab === 'anim';
  ['build', 'gen', 'conv'].forEach(t => $('#pane-' + t).classList.toggle('hidden', anim || t !== tab));
  ['sysview', 'tableview', 'factsview'].forEach(id => $('#' + id).classList.toggle('hidden', anim || !sim));
  $('#animview').classList.toggle('hidden', !anim);
  if (anim) {
    const ok = window.LIDAnim.show($('#spec').value);
    if (!ok) $('#a-err').textContent = 'The spec cannot be animated: ' + ($('#spec-err').textContent || 'fix it in “Build your own” and generate the table first.');
    window.scrollTo(0, 0);
  } else window.LIDAnim.hide();
}
document.querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', () => selectTab(b.dataset.tab)));
$('#btn-anim').addEventListener('click', () => selectTab('anim'));
$('#a-back').addEventListener('click', () => { selectTab('build'); $('#tableview').scrollIntoView({ behavior: 'smooth', block: 'start' }); });
$('#btn-load').addEventListener('click', () => { $('#spec').value = EXAMPLES[$('#example').value]; $('#spec-err').textContent = ''; });
$('#btn-build').addEventListener('click', () => build($('#spec').value));
$('#opt-queues').addEventListener('change', () => { renderTable(); saveState(); });
$('#opt-strict').addEventListener('change', () => { $('#strictwrap').classList.toggle('hidden', !$('#opt-strict').checked); renderStrict(); });
$('#btn-check').addEventListener('click', check);
$('#btn-unmark').addEventListener('click', () => { document.querySelectorAll('#trace input[data-id], #strict input[data-id]').forEach(el => el.classList.remove('ok', 'bad', 'blank', 'solved')); $('#results').innerHTML = ''; });
$('#btn-reveal').addEventListener('click', reveal);
$('#btn-clear').addEventListener('click', () => { answers = {}; renderTable(); renderStrict(); $('#results').innerHTML = ''; saveState(); });
$('#btn-explain').addEventListener('click', () => { const c = $('#cycles'); c.classList.toggle('hidden'); if (!c.classList.contains('hidden')) renderCycles(); });

/* ---------- build ---------- */
let build = function (text) {
  $('#spec-err').textContent = '';
  try {
    spec = LID.parseSpec(text);
    sim = LID.simulate(spec);
    strictSim = LID.simulateStrict(spec, spec.cycles);
  } catch (e) { $('#spec-err').textContent = e.message; return; }
  answers = {}; $('#results').innerHTML = ''; $('#cycles').classList.add('hidden');
  $('#sysview').classList.remove('hidden'); $('#tableview').classList.remove('hidden'); $('#factsview').classList.remove('hidden');
  renderSystem(); renderTable(); renderStrict();
  $('#tableview').scrollIntoView({ behavior: 'smooth', block: 'start' });
};

/* ---------- system view ---------- */
function renderSystem() {
  const E = sim.E; const facts = [];
  const cap = (sh) => (sh.queueCap != null ? sh.queueCap : spec.queueCap);
  facts.push(['Shells', E.shells.map(s => s.name + ' (queues ' + (cap(s) === INF ? '∞' : cap(s)) + ')').join(', ')]);
  E.shells.forEach(s => facts.push([s.name, s.regs.map(r => r.name + '(n+1) = ' + r.expr).join('; ')]));
  facts.push(['Primary inputs', E.primaryInputs.map(p => p.name).join(', ')]);
  facts.push(['Primary outputs', spec.outputs.map(o => o.name + ' = ' + o.from.shell + '.' + o.from.reg).join(', ') || 'none']);
  const rsList = E.channels.filter(c => c.rs > 0).map(c => c.rs + ' on ' + c.src.shell + '.' + c.src.reg + ' → ' + (c.dst.kind === 'env' ? c.dst.name : c.dst.shell + '.' + c.dst.input));
  facts.push(['Relay stations', rsList.length ? rsList.join('; ') : 'none']);
  const ti = LID.throughputInfo(spec);
  if (ti.cycles.length) facts.push(['Cycles', ti.cycles.map(c => c.path.join('→') + '→' + c.path[0] + ': ' + c.s + ' shells, ' + c.r + ' RS → ' + c.s + '/' + (c.s + c.r) + ' = ' + c.mean.toFixed(2)).join('; ')]);
  facts.push(['Max sustainable throughput', ti.cycles.length ? ti.mst.toFixed(2) + ' (slowest cycle)' : '1 (acyclic)']);
  const valid = sim.rows.filter(r => spec.outputs.length && !r.segs[E.channels.find(c => c.dst.kind === 'env').id + '/0'].v).length;
  if (spec.outputs.length) facts.push(['Observed throughput', valid + ' valid tokens on ' + spec.outputs[0].name + ' over ' + spec.cycles + ' cycles = ' + (valid / spec.cycles).toFixed(2)]);
  $('#facts').innerHTML = facts.map(([k, v]) => '<dt>' + esc(k) + '</dt><dd class="mono">' + esc(v) + '</dd>').join('');
  $('#diagram').innerHTML = drawDiagram();
  $('#schematic').innerHTML = drawSchematic();
}
function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

function drawDiagram() {
  const E = sim.E; const shells = E.shells; const idx = {}; shells.forEach((s, i) => idx[s.name] = i);
  // levels: longest path from sources ignoring back edges found by DFS
  const adj = shells.map(() => []);
  E.channels.filter(c => c.dst.kind === 'shell').forEach(c => adj[idx[c.src.shell]].push(idx[c.dst.shell]));
  const color = shells.map(() => 0), back = new Set();
  function dfs(u) { color[u] = 1; adj[u].forEach(v => { if (color[v] === 1) back.add(u + '>' + v); else if (!color[v]) dfs(v); }); color[u] = 2; }
  shells.forEach((_, i) => { if (!color[i]) dfs(i); });
  const level = shells.map(() => 0); let changed = true, guard = 0;
  while (changed && guard++ < 50) { changed = false; shells.forEach((_, u) => adj[u].forEach(v => { if (!back.has(u + '>' + v) && level[v] < level[u] + 1) { level[v] = level[u] + 1; changed = true; } })); }
  const cols = {}; shells.forEach((s, i) => { (cols[level[i]] = cols[level[i]] || []).push(i); });
  const BW = 150, COLGAP = 110, ROWGAP = 36, PAD = 60;
  const pos = {}; let maxH = 0;
  Object.keys(cols).sort((a, b) => a - b).forEach(l => {
    let y = PAD;
    cols[l].forEach(i => { const sh = shells[i]; const h = 34 + Math.max(sh.inputs.length, sh.regs.length) * 15 + 6; pos[i] = { x: PAD + l * (BW + COLGAP), y, h }; y += h + ROWGAP; });
    maxH = Math.max(maxH, y);
  });
  const W = PAD * 2 + (Object.keys(cols).length - 1) * (BW + COLGAP) + BW + 60, H = maxH + 20;
  let svg = '';
  const portY = (i, k) => pos[i].y + 30 + k * 15;
  shells.forEach((sh, i) => {
    const p = pos[i];
    svg += `<rect class="box" x="${p.x}" y="${p.y}" width="${BW}" height="${p.h}" rx="4"/>`;
    svg += `<text class="boxlabel" x="${p.x + 8}" y="${p.y + 17}">${esc(sh.name)}</text>`;
    sh.inputs.forEach((inp, k) => { svg += `<text class="port" x="${p.x + 8}" y="${portY(i, k) + 4}">${esc(inp.name)}</text>`; });
    sh.regs.forEach((r, k) => { svg += `<text class="eq" x="${p.x + BW - 8}" y="${portY(i, k) + 4}" text-anchor="end">${esc(r.name + '=' + r.expr)}</text>`; });
  });
  // primary inputs
  shells.forEach((sh, i) => sh.inputs.forEach((inp, k) => {
    if (inp.from) return; const p = pos[i]; const y = portY(i, k);
    svg += `<path class="wire" d="M${p.x - 40},${y} L${p.x},${y}" marker-end="url(#arr)"/><text class="chan" x="${p.x - 44}" y="${y + 4}" text-anchor="end">${esc(inp.name)}</text>`;
  }));
  E.channels.forEach(c => {
    const si = idx[c.src.shell]; const sp = pos[si]; const sk = shells[si].regs.findIndex(r => r.name === c.src.reg);
    const x1 = sp.x + BW, y1 = portY(si, sk);
    let x2, y2, label;
    if (c.dst.kind === 'env') { x2 = x1 + 70; y2 = y1; label = c.dst.name; }
    else { const di = idx[c.dst.shell]; const dp = pos[di]; const dk = shells[di].inputs.findIndex(x => x.name === c.dst.input); x2 = dp.x; y2 = portY(di, dk); label = ''; }
    let d, mid;
    if (c.dst.kind === 'env') { d = `M${x1},${y1} L${x2},${y2}`; mid = [(x1 + x2) / 2, y1]; svg += `<text class="chan" x="${x2 + 4}" y="${y2 + 4}">${esc(label)}</text>`; }
    else if (x2 > x1) { const cx = (x1 + x2) / 2; d = `M${x1},${y1} C${cx},${y1} ${cx},${y2} ${x2},${y2}`; mid = [cx, (y1 + y2) / 2]; }
    else { // feedback: route below
      const yb = Math.max(sp.y + sp.h, pos[idx[c.dst.shell]].y + pos[idx[c.dst.shell]].h) + 22 + (c.id % 3) * 10;
      d = `M${x1},${y1} L${x1 + 20},${y1} L${x1 + 20},${yb} L${x2 - 20},${yb} L${x2 - 20},${y2} L${x2},${y2}`; mid = [(x1 + x2) / 2, yb];
    }
    svg += `<path class="wire" d="${d}" marker-end="url(#arr)"/>`;
    for (let k = 1; k <= c.rs; k++) {
      const t = k / (c.rs + 1); let px, py;
      if (c.dst.kind === 'env' || x2 > x1) { px = x1 + (x2 - x1) * t; py = c.dst.kind === 'env' ? y1 : bezierY(y1, y2, t); }
      else { px = (x1 + 20) + ((x2 - 20) - (x1 + 20)) * t; py = mid[1]; }
      svg += `<rect class="rs" x="${px - 11}" y="${py - 9}" width="22" height="18" rx="2"/><text class="rslabel" x="${px}" y="${py + 3.5}" text-anchor="middle">RS</text>`;
    }
  });
  return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Block diagram of the shells, channels and relay stations"><defs><marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="currentColor"/></marker></defs><g style="color:var(--fg)">${svg}</g></svg>`;
}
/* ---------- schematic: datapath inside each shell ---------- */
const OPSYM = { '+': '+', '-': '−', '*': '×', '/': '÷', '%': 'mod', '==': '=', '!=': '≠', '<': '<', '<=': '≤', '>': '>', '>=': '≥', '&&': '∧', '||': '∨' };
function shellSchematic(sh, C) {
  // --- nodes & edges from the register equations ---
  const nodes = []; const byId = {}; let uid = 0;
  const add = (n) => { n.id = n.id || ('n' + (uid++)); n.inputs = n.inputs || []; nodes.push(n); byId[n.id] = n; return n; };
  sh.inputs.forEach(i => add({ id: 'in:' + i.name, kind: 'in', label: i.name }));
  sh.regs.forEach(r => add({ id: 'ff:' + r.name, kind: 'ff', label: r.name }));
  function visit(ast) {
    switch (ast.k) {
      case 'id': return byId['in:' + ast.v] ? 'in:' + ast.v : 'ff:' + ast.v;
      case 'num': return add({ kind: 'const', label: String(ast.v) }).id;
      case 'neg': return add({ kind: 'op', label: '−', inputs: [visit(ast.a)], pins: [''] }).id;
      case 'not': return add({ kind: 'op', label: '¬', inputs: [visit(ast.a)], pins: [''] }).id;
      case 'bin': return add({ kind: 'op', label: OPSYM[ast.op] || ast.op, inputs: [visit(ast.a), visit(ast.b)], pins: ['', ''] }).id;
      case 'tern': return add({ kind: 'op', label: 'MUX', inputs: [visit(ast.c), visit(ast.a), visit(ast.b)], pins: ['sel', '1', '0'] }).id;
    }
  }
  sh.regs.forEach(r => { byId['ff:' + r.name].inputs = [visit(r.ast)]; });
  // --- levels along the dataflow; feedback edges broken by the DFS ---
  const lvl = (n, seen = new Set()) => {
    if (n.kind === 'in' || n.kind === 'const') return 0;
    if (n.level != null) return n.level;
    if (seen.has(n.id)) return 0; seen.add(n.id);
    n.level = 1 + Math.max(0, ...n.inputs.map(i => lvl(byId[i], seen))); return n.level;
  };
  nodes.forEach(n => { n.level = lvl(n); });
  let maxL = Math.max(1, ...nodes.map(n => n.level));
  nodes.filter(n => n.kind === 'const').forEach(c => { const cons = nodes.find(n => n.inputs.includes(c.id)); c.level = cons ? Math.max(0, cons.level - 1) : 0; });
  // output pins of the shell: one 'out' node per exported register, in the last column
  const outLevel = maxL + 1;
  sh.regs.filter(r => sh.outs.includes(r.name)).forEach(r => add({ id: 'out:' + r.name, kind: 'out', label: r.name, inputs: ['ff:' + r.name], level: outLevel }));
  maxL = outLevel;
  // --- edges; long forward edges get dummy nodes in every intermediate column ---
  const edges = []; // {src, dst, k, chain:[nodeIds...] from src to dst}
  nodes.slice().forEach(n => n.inputs.forEach((srcId, k) => {
    const s = byId[srcId]; const e = { src: srcId, dst: n.id, k, feedback: s.level >= n.level && !(s.kind === 'in' || s.kind === 'const') };
    if (s.kind === 'in' || s.kind === 'const') e.feedback = false;
    const chain = [srcId];
    if (!e.feedback) for (let l = s.level + 1; l < n.level; l++) { const d = add({ kind: 'dummy', level: l, label: '' }); d.edge = e; chain.push(d.id); }
    chain.push(n.id); e.chain = chain; edges.push(e);
  }));
  // --- crossing reduction: barycenter sweeps ---
  const cols = []; for (let l = 0; l <= maxL; l++) cols.push([]);
  nodes.forEach(n => cols[n.level].push(n));
  const rowOf = {}; const setRows = () => cols.forEach(col => col.forEach((n, i) => rowOf[n.id] = i));
  setRows();
  const preds = {}, succs = {}; nodes.forEach(n => { preds[n.id] = []; succs[n.id] = []; });
  edges.forEach(e => { for (let i = 0; i + 1 < e.chain.length; i++) { const a = e.chain[i], b = e.chain[i + 1]; if (byId[a].level < byId[b].level) { preds[b].push(a); succs[a].push(b); } } });
  const bary = (ids) => ids.length ? ids.reduce((s, id) => s + rowOf[id], 0) / ids.length : null;
  for (let sweep = 0; sweep < 4; sweep++) {
    const forward = sweep % 2 === 0;
    const order = forward ? cols.map((_, i) => i).slice(1) : cols.map((_, i) => i).slice(0, -1).reverse();
    order.forEach(l => {
      const col = cols[l];
      const key = {}; col.forEach((n, i) => { const b = bary(forward ? preds[n.id] : succs[n.id]); key[n.id] = b == null ? i : b; });
      col.sort((a, b) => key[a.id] - key[b.id] || rowOf[a.id] - rowOf[b.id]);
      setRows();
    });
  }
  // --- coordinates ---
  const ROWH = 32, COLW = 72, PADX = 44, PADY = 28, QW = 20;
  const maxRows = Math.max(...cols.map(c => c.length), 1);
  const H = PADY * 2 + maxRows * ROWH;
  const W = PADX * 2 + maxL * COLW;
  const pos = {};
  cols.forEach((col, l) => {
    // vertically center each column, but keep rows on a common grid so straight runs stay straight
    const y0 = (H - col.length * ROWH) / 2 + ROWH / 2;
    col.forEach((n, i) => { pos[n.id] = { x: PADX + l * COLW, y: y0 + i * ROWH }; });
  });
  // snap dummies to the average of their neighbours when it does not collide (straighter wires)
  const outX = (n) => { const p = pos[n.id]; return n.kind === 'in' ? p.x + QW / 2 + 2 : (n.kind === 'const' ? p.x + 8 : (n.kind === 'ff' ? p.x + 10 : (n.kind === 'op' ? p.x + 13 : p.x))); };
  const inX = (n) => { const p = pos[n.id]; return n.kind === 'ff' ? p.x - 10 : (n.kind === 'op' ? p.x - 13 : p.x); };
  let svg = '', wires = '';
  nodes.forEach(n => {
    const p = pos[n.id];
    if (n.kind === 'in') {
      const slots = C === INF ? 3 : Math.min(C, 4); const sh_ = 7; const qx = p.x - QW / 2;
      svg += `<rect class="queue" x="${qx}" y="${p.y - (slots * sh_) / 2}" width="${QW}" height="${slots * sh_}" rx="1"/>`;
      for (let s = 1; s < slots; s++) svg += `<line class="wire" style="stroke:var(--muted);stroke-width:.8" x1="${qx}" y1="${p.y - (slots * sh_) / 2 + s * sh_}" x2="${qx + QW}" y2="${p.y - (slots * sh_) / 2 + s * sh_}"/>`;
      if (C === INF) svg += `<text class="pin" x="${p.x}" y="${p.y + (slots * sh_) / 2 + 9}" text-anchor="middle">∞</text>`;
      svg += `<text class="port" x="${qx - 4}" y="${p.y + 4}" text-anchor="end">${esc(n.label)}</text>`;
      wires += `<path class="wire" d="M0,${p.y} L${qx},${p.y}"/>`;
    } else if (n.kind === 'const') {
      svg += `<text class="const" x="${p.x + 6}" y="${p.y + 4}" text-anchor="end">${esc(n.label)}</text>`;
    } else if (n.kind === 'op') {
      if (n.label === 'MUX') svg += `<path class="op" d="M${p.x - 11},${p.y - 16} L${p.x + 11},${p.y - 9} L${p.x + 11},${p.y + 9} L${p.x - 11},${p.y + 16} Z"/><text class="oplabel" style="font-size:8px" x="${p.x}" y="${p.y + 3}" text-anchor="middle">MUX</text>`;
      else svg += `<circle class="op" cx="${p.x}" cy="${p.y}" r="13"/><text class="oplabel" x="${p.x}" y="${p.y + 4}" text-anchor="middle">${esc(n.label)}</text>`;
    } else if (n.kind === 'ff') {
      svg += `<rect class="ff" x="${p.x - 10}" y="${p.y - 14}" width="20" height="28" rx="2"/><path class="clk" d="M${p.x - 4},${p.y + 12} L${p.x + 4},${p.y + 12} L${p.x},${p.y + 5} Z"/><text class="fflabel" x="${p.x + 12}" y="${p.y - 9}">${esc(n.label)}</text>`;
    } else if (n.kind === 'out') {
      wires += `<path class="wire" d="M${p.x},${p.y} L${W},${p.y}"/>`;
    }
  });
  // wires
  const pinY = (n, k) => { let y = pos[n.id].y; if (n.inputs.length > 1) y += (k - (n.inputs.length - 1) / 2) * (n.label === 'MUX' ? 9 : 8); return y; };
  edges.forEach(e => {
    const dst = byId[e.dst]; const y2 = pinY(dst, e.k); const x2 = inX(dst);
    if (dst.pins && dst.pins[e.k]) svg += `<text class="pin" x="${x2 + 3}" y="${y2 + 3}">${esc(dst.pins[e.k])}</text>`;
    const arrow = dst.kind === 'out' ? '' : ' marker-end="url(#arr)"';
    if (e.feedback) {
      const s = byId[e.src]; const x1 = outX(s), y1 = pos[s.id].y; const yb = H - 10 - (edges.indexOf(e) % 3) * 6;
      wires += `<path class="wire" d="M${x1},${y1} L${x1 + 10},${y1} L${x1 + 10},${yb} L${x2 - 14},${yb} L${x2 - 14},${y2} L${x2},${y2}"${arrow}/>`; return;
    }
    // polyline through the dummies: source -> d1 -> ... -> destination pin, smooth between columns
    const pts = e.chain.map((id, i) => { const n = byId[id]; if (i === 0) return [outX(n), pos[id].y]; if (i === e.chain.length - 1) return [x2, y2]; return [pos[id].x, pos[id].y]; });
    let d = `M${pts[0][0]},${pts[0][1]}`;
    for (let i = 1; i < pts.length; i++) { const [xa, ya] = pts[i - 1], [xb, yb] = pts[i]; if (Math.abs(ya - yb) < 0.5) d += ` L${xb},${yb}`; else { const cx = (xa + xb) / 2; d += ` L${cx},${ya} L${cx},${yb} L${xb},${yb}`; } }
    wires += `<path class="wire" d="${d}"${arrow}/>`;
  });
  const regY = {}; sh.regs.forEach(r => { regY[r.name] = pos['out:' + r.name] ? pos['out:' + r.name].y : pos['ff:' + r.name].y; });
  const portY = {}; sh.inputs.forEach(i => { portY[i.name] = pos['in:' + i.name].y; });
  svg = `<rect class="shellbox" x="8" y="2" width="${W - 16}" height="${H - 4}" rx="10"/><text class="shelllabel" x="16" y="14">shell ${esc(sh.name)}</text>` + wires + svg;
  return { W, H, svg, portY, regY };
}
function drawSchematic() {
  const E = sim.E; const shells = E.shells; const idx = {}; shells.forEach((s, i) => idx[s.name] = i);
  const sch = shells.map(sh => shellSchematic(sh, sh.queueCap != null ? sh.queueCap : spec.queueCap));
  const adj = shells.map(() => []);
  E.channels.filter(c => c.dst.kind === 'shell').forEach(c => adj[idx[c.src.shell]].push(idx[c.dst.shell]));
  const color = shells.map(() => 0), back = new Set();
  function dfs(u) { color[u] = 1; adj[u].forEach(v => { if (color[v] === 1) back.add(u + '>' + v); else if (!color[v]) dfs(v); }); color[u] = 2; }
  shells.forEach((_, i) => { if (!color[i]) dfs(i); });
  const level = shells.map(() => 0); let changed = true, guard = 0;
  while (changed && guard++ < 50) { changed = false; shells.forEach((_, u) => adj[u].forEach(v => { if (!back.has(u + '>' + v) && level[v] < level[u] + 1) { level[v] = level[u] + 1; changed = true; } })); }
  const cols = {}; shells.forEach((s, i) => { (cols[level[i]] = cols[level[i]] || []).push(i); });
  const COLGAP = 110, ROWGAP = 40, PAD = 60;
  const pos = {}; let maxH = 0, x = PAD; const colKeys = Object.keys(cols).sort((a, b) => a - b);
  colKeys.forEach(l => { let y = PAD / 2; const cw = Math.max(...cols[l].map(i => sch[i].W)); cols[l].forEach(i => { pos[i] = { x, y }; y += sch[i].H + ROWGAP; }); maxH = Math.max(maxH, y); x += cw + COLGAP; });
  const W = x - COLGAP + 130, H = maxH + 30;
  let svg = '';
  shells.forEach((sh, i) => { svg += `<g transform="translate(${pos[i].x},${pos[i].y})">${sch[i].svg}</g>`; });
  shells.forEach((sh, i) => sh.inputs.forEach(inp => { if (inp.from) return; const y = pos[i].y + sch[i].portY[inp.name]; svg += `<path class="wire" d="M${pos[i].x - 40},${y} L${pos[i].x},${y}"/><text class="chan" x="${pos[i].x - 44}" y="${y + 4}" text-anchor="end">${esc(inp.name)}</text>`; }));
  E.channels.forEach(c => {
    const si = idx[c.src.shell]; const x1 = pos[si].x + sch[si].W, y1 = pos[si].y + sch[si].regY[c.src.reg];
    let x2, y2, d, rsPts = [];
    if (c.dst.kind === 'env') {
      const xEnd = W - 70; const maxLevel = Math.max(...level);
      if (level[si] === maxLevel) { x2 = xEnd; y2 = y1; d = `M${x1},${y1} L${x2},${y2}`; for (let k = 1; k <= c.rs; k++) rsPts.push([x1 + (x2 - x1) * k / (c.rs + 1), y1]); }
      else { const yt = 14 + (c.id % 3) * 8; x2 = xEnd; y2 = yt; d = `M${x1},${y1} L${x1 + 16},${y1} L${x1 + 16},${yt} L${x2},${yt}`; for (let k = 1; k <= c.rs; k++) rsPts.push([(x1 + 16) + (x2 - x1 - 16) * k / (c.rs + 1), yt]); }
      svg += `<text class="chan" x="${x2 + 6}" y="${y2 + 4}">${esc(c.dst.name)} (output)</text>`;
    }
    else {
      const di = idx[c.dst.shell]; x2 = pos[di].x; y2 = pos[di].y + sch[di].portY[c.dst.input];
      if (x2 > x1 && level[di] - level[si] > 1) { const yt = 14 + (c.id % 3) * 8; d = `M${x1},${y1} L${x1 + 16},${y1} L${x1 + 16},${yt} L${x2 - 16},${yt} L${x2 - 16},${y2} L${x2},${y2}`; for (let k = 1; k <= c.rs; k++) rsPts.push([(x1 + 16) + ((x2 - 16) - (x1 + 16)) * k / (c.rs + 1), yt]); }
      else if (x2 > x1) { const cx = (x1 + x2) / 2; d = `M${x1},${y1} L${cx},${y1} L${cx},${y2} L${x2},${y2}`; for (let k = 1; k <= c.rs; k++) { const t = k / (c.rs + 1); rsPts.push(t <= 0.5 ? [x1 + (cx - x1) * (t * 2) * 0.8 + 6, y1] : [cx + (x2 - cx) * ((t - 0.5) * 2) * 0.8 + 6, y2]); } }
      else { const yb = Math.max(pos[si].y + sch[si].H, pos[di].y + sch[di].H) + 18 + (c.id % 3) * 10; d = `M${x1},${y1} L${x1 + 22},${y1} L${x1 + 22},${yb} L${x2 - 22},${yb} L${x2 - 22},${y2} L${x2},${y2}`; for (let k = 1; k <= c.rs; k++) rsPts.push([(x1 + 22) + ((x2 - 22) - (x1 + 22)) * k / (c.rs + 1), yb]); }
    }
    svg += `<path class="wire" d="${d}" marker-end="url(#arr)"/>`;
    rsPts.forEach(([px, py]) => { svg += `<rect class="rs" x="${px - 11}" y="${py - 9}" width="22" height="18" rx="2"/><text class="rslabel" x="${px}" y="${py + 3.5}" text-anchor="middle">RS</text>`; });
  });
  return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Schematic of the cores inside each shell, with queues, flip-flops, channels and relay stations"><defs><marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="currentColor"/></marker></defs><g style="color:var(--fg)">${svg}</g></svg>`;
}
function bezierY(y1, y2, t) { const u = 1 - t; return u * u * u * y1 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y2; }

/* ---------- table ---------- */
function cellId(kind, key, n) { return kind + '|' + key + '|' + n; }
function norm(kind, s) {
  s = (s == null ? '' : String(s)).trim();
  if (kind === 'bit') return s === '' ? '0' : (s === '1' ? '1' : (s === '0' ? '0' : s));
  const one = (t) => { t = t.trim(); if (t === '-' || t === '−' || t === '—' || t === '—') return '-'; const x = Number(t); return Number.isNaN(x) ? t : String(x); };
  if (kind === 'queue') { s = s.replace(/[\[\]{}()]/g, ''); if (s === '' || /^(∅|empty|none|\.|·)$/i.test(s)) return ''; return s.split(/[\s,;]+/).filter(Boolean).map(one).join(','); }
  if (s === '') return '';
  return one(s);
}
function fmtQ(arr) { return arr.map(fmt).join(','); }
function fmtQexp(qi) { if (qi.bypass !== undefined) return '\\' + fmt(qi.bypass); if (!qi.shown.length) return ''; return (qi.popped ? '\\' : '') + fmtQ(qi.shown); }
function parseQ(s) {
  s = (s == null ? '' : String(s)).trim().replace(/[\[\]{}()]/g, '');
  if (s === '' || /^(∅|empty|none|\.|·)$/i.test(s)) return { list: [], consumed: false };
  const toks = s.split(/[\s,;]+/).filter(Boolean); let consumed = false;
  if (/[\\\/*]/.test(toks[0])) { consumed = true; toks[0] = toks[0].replace(/[\\\/*]/g, ''); if (toks[0] === '') toks.shift(); }
  const one = (t) => { if (t === '-' || t === '−' || t === '—') return '-'; const x = Number(t); return Number.isNaN(x) ? t : String(x); };
  return { list: toks.map(one), consumed };
}
function checkQueue(ans, qi) {
  const a = parseQ(ans); const exp = qi.shown.map(v => norm('data', fmt(v))); const same = (l1, l2) => l1.length === l2.length && l1.every((v, i) => v === l2[i]);
  if (qi.bypass !== undefined) {
    const b = norm('data', fmt(qi.bypass));
    if (a.list.length === 0) return { ok: true };
    if (same(a.list, [b])) return a.consumed ? { ok: true } : { ok: false, why: `${b} was never stored: it arrived when the queue was empty and the shell fired, so it bypassed the queue. Either leave the cell blank or mark it as consumed on arrival (\\${b}).` };
    return { ok: false };
  }
  if (!same(a.list, exp)) return { ok: false };
  if (a.consumed && !qi.popped) return { ok: false, why: exp.length ? `The contents are right, but you marked ${exp[0]} as consumed: the shell does not fire at this cycle, so the head stays in the queue.` : 'Nothing is consumed from an empty queue.' };
  return { ok: true };
}

function buildCells() {
  const E = sim.E; cells = []; const showQ = $('#opt-queues').checked;
  const rows = sim.rows;
  const push = (c) => { c.id = cellId(c.kind, c.key, c.n); cells.push(c); };
  rows.forEach(r => {
    const n = r.n; const given1 = n === 1;
    E.primaryInputs.forEach(p => push({ kind: 'bit', key: 'in-s/' + p.name, n, expected: String(r.inputs[p.name].s), given: given1, explain: () => explainInStop(p.name, n), label: 'stop on input ' + p.name }));
    E.shells.forEach(sh => {
      const rec = r.shells[sh.name];
      if (showQ) sh.inputs.forEach(i => { const qi = rec.queues[i.name]; const info = { shown: qi.shown, popped: rec.fired && qi.shown.length > 0, bypass: qi.bypass ? qi.arriving.d : undefined };
        push({ kind: 'queue', key: 'q/' + sh.name + '/' + i.name, n, expected: fmtQexp(info), qinfo: info, given: given1, explain: () => explainQueue(sh.name, i.name, n), label: 'queue ' + i.name + ' of ' + sh.name }); });
      sh.regs.filter(rg => !sh.outs.includes(rg.name)).forEach(rg => push({ kind: 'data', key: 'reg/' + sh.name + '/' + rg.name, n, expected: fmt(rec.regs[rg.name]), given: given1, explain: () => explainReg(sh.name, rg.name, n), label: sh.name + '.' + rg.name + ' (internal)' }));
    });
    E.channels.forEach(ch => {
      for (let k = 0; k <= ch.rs; k++) {
        const seg = r.segs[ch.id + '/' + k]; const key = 'seg/' + ch.id + '/' + k; const lab = segLabel(ch, k);
        const isEnvStop = (k === ch.rs && ch.dst.kind === 'env');
        push({ kind: 'data', key: key + '/d', n, expected: fmt(seg.d), voidTok: !!seg.v, given: given1, explain: () => explainSegD(ch, k, n), label: lab + ' data' });
        push({ kind: 'bit', key: key + '/v', n, expected: String(seg.v), given: given1, explain: () => explainSegV(ch, k, n), label: lab + ' void' });
        push({ kind: 'bit', key: key + '/s', n, expected: String(seg.s), given: given1 || isEnvStop, explain: () => explainSegS(ch, k, n), label: lab + ' stop' });
      }
    });
  });
}
function segLabel(ch, k) {
  const E = sim.E;
  if (ch.dst.kind === 'env') return ch.dst.name;
  const base = ch.src.reg + '→' + ch.dst.shell + '.' + ch.dst.input;
  if (ch.rs === 0) return base;
  return k === 0 ? ch.src.reg + '→RS1' : (k < ch.rs ? 'RS' + k + '→RS' + (k + 1) : 'RS' + k + '→' + ch.dst.shell + '.' + ch.dst.input);
}

function renderTable() {
  if (!sim) return;
  buildCells();
  const E = sim.E; const showQ = $('#opt-queues').checked; const t = $('#trace');
  // header groups
  const groups = []; // {title, cols:[{html, keys}]}
  const qcol = (shName, inName) => ({ title: 'q', cls: 'qc', render: (n) => inputEl('queue', 'q/' + shName + '/' + inName, n) });
  // Input group: each primary input followed by its queue column(s)
  const inCols = [];
  E.primaryInputs.forEach(p => {
    inCols.push({ title: p.name + '(v, s)', render: (n, r) => tok(r.inputs[p.name].d, r.inputs[p.name].v, 'in-s/' + p.name, n, true, true, false) });
    if (showQ) E.shells.forEach(sh => sh.inputs.forEach(i => { if (!i.from && i.name === p.name) inCols.push(qcol(sh.name, i.name)); }));
  });
  groups.push({ title: 'Input', cols: inCols });
  E.shells.forEach(sh => {
    const cols = [];
    sh.regs.filter(rg => !sh.outs.includes(rg.name)).forEach(rg => cols.push({ title: rg.name, render: (n) => inputEl('data', 'reg/' + sh.name + '/' + rg.name, n) }));
    if (cols.length) groups.push({ title: (E.shells.length > 1 ? sh.name + ' ' : '') + 'internal', cols });
  });
  const chanCols = []; const outCols = [];
  E.channels.forEach(ch => { for (let k = 0; k <= ch.rs; k++) {
    const key = 'seg/' + ch.id + '/' + k; const col = { title: segLabel(ch, k) + '(v, s)', render: (n) => tok(null, null, key, n, false, false, (k === ch.rs && ch.dst.kind === 'env')) };
    (ch.dst.kind === 'env' ? outCols : chanCols).push(col);
    if (showQ && k === ch.rs && ch.dst.kind === 'shell') chanCols.push(qcol(ch.dst.shell, ch.dst.input));
  } });
  if (chanCols.length) groups.push({ title: 'Channels', cols: chanCols });
  if (outCols.length) groups.push({ title: 'Output', cols: outCols });
  let h = '<thead><tr class="grp"><th rowspan="2">n</th>' + groups.map(g => `<th colspan="${g.cols.length}">${esc(g.title)}</th>`).join('') + '</tr><tr>' + groups.map(g => g.cols.map(c => `<th${c.cls ? ' class="' + c.cls + '"' : ''}>${esc(c.title)}</th>`).join('')).join('') + '</tr></thead><tbody>';
  sim.rows.forEach(r => { h += `<tr><td class="n">${r.n}</td>` + groups.map(g => g.cols.map(c => c.render(r.n, r)).join('')).join('') + '</tr>'; });
  t.innerHTML = h + '</tbody>';
  wireInputs(t);
  const fillable = cells.filter(c => !c.given).length; $('#count').textContent = fillable + ' cells to fill';
}
const cellById = (id) => cells.find(c => c.id === id);
function inputEl(kind, key, n, extraClass) {
  const id = cellId(kind, key, n); const c = cellById(id); if (!c) return '<td></td>';
  if (c.given) return `<td class="given">${esc(c.expected === '' ? '' : c.expected)}</td>`;
  const cls = kind === 'bit' ? 'b' : (kind === 'queue' ? 'q' : 'd');
  return (extraClass === 'inline' ? '' : '<td>') + `<input type="text" class="${cls}" data-id="${esc(id)}" id="c_${esc(id).replace(/[^A-Za-z0-9_]/g, '_')}" value="${esc(answers[id] || '')}" autocomplete="off" aria-label="${esc(c.label + ' at n=' + n)}">` + (extraClass === 'inline' ? '' : '</td>');
}
function tok(d, v, key, n, dGiven, vGiven, sGiven) {
  // for primary inputs key = 'in-s/x' (d,v given); for segments key = 'seg/..' with d,v,s cells
  if (key.startsWith('in-s/')) {
    const sid = cellId('bit', key, n); const sc = cellById(sid);
    const sPart = sc.given ? `<span class="g">${sc.expected}</span>` : inputEl('bit', key, n, 'inline');
    return `<td${sc.given ? ' class="given"' : ''}><span class="tok"><span class="g">${esc(fmt(d))}</span><span class="g">(</span><span class="g">${v}</span><span class="g">,</span>${sPart}<span class="g">)</span></span></td>`;
  }
  const dc = cellById(cellId('data', key + '/d', n)), vc = cellById(cellId('bit', key + '/v', n)), sc = cellById(cellId('bit', key + '/s', n));
  const part = (c, kind, k) => c.given ? `<span class="g">${esc(c.expected)}</span>` : inputEl(kind, key + '/' + k, n, 'inline');
  const allGiven = dc.given && vc.given && sc.given;
  return `<td${allGiven ? ' class="given"' : ''}><span class="tok">${part(dc, 'data', 'd')}<span class="g">(</span>${part(vc, 'bit', 'v')}<span class="g">,</span>${part(sc, 'bit', 's')}<span class="g">)</span></span></td>`;
}
function wireInputs(t) {
  t.querySelectorAll('input[data-id]').forEach(inp => {
    inp.addEventListener('input', () => { answers[inp.dataset.id] = inp.value; inp.classList.remove('ok', 'bad', 'blank', 'solved'); });
    inp.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Enter') return;
      const [kind, key, n] = inp.dataset.id.split('|'); const m = +n + (e.key === 'ArrowUp' ? -1 : 1);
      const nxt = t.querySelector(`input[data-id="${CSS.escape(cellId(kind, key, m))}"]`); if (nxt) { e.preventDefault(); nxt.focus(); nxt.select(); }
    });
  });
}

/* ---------- strict table ---------- */
function renderStrict() {
  if (!sim || !$('#opt-strict').checked) return;
  const E = strictSim.E; const t = $('#strict'); const regsCols = [];
  E.shells.forEach(sh => sh.regs.forEach(r => regsCols.push({ sh: sh.name, r: r.name })));
  let h = '<thead><tr class="grp"><th rowspan="2">n</th><th colspan="' + E.primaryInputs.length + '">Input</th><th colspan="' + regsCols.length + '">Registers</th></tr><tr>' + E.primaryInputs.map(p => '<th>' + esc(p.name) + '</th>').join('') + regsCols.map(c => '<th>' + esc((E.shells.length > 1 ? c.sh + '.' : '') + c.r) + '</th>').join('') + '</tr></thead><tbody>';
  strictSim.rows.forEach(row => {
    h += '<tr><td class="n">' + row.n + '</td>' + E.primaryInputs.map(p => '<td class="given">' + esc(fmt(row.inputs[p.name])) + '</td>').join('');
    regsCols.forEach(c => { const id = cellId('data', 'strict/' + c.sh + '/' + c.r, row.n); const exp = fmt(row.regs[c.sh][c.r]);
      if (row.n === 1) h += '<td class="given">' + esc(exp) + '</td>';
      else h += `<td><input type="text" class="d" data-id="${esc(id)}" data-expected="${esc(exp)}" value="${esc(answers[id] || '')}" autocomplete="off" aria-label="strict ${esc(c.r)} at n=${row.n}"></td>`; });
    h += '</tr>';
  });
  t.innerHTML = h + '</tbody>'; wireInputs(t);
}

/* ---------- check / reveal ---------- */
function check() {
  let right = 0, wrong = 0, blank = 0; const mistakes = [];
  cells.filter(c => !c.given).forEach(c => {
    const el = document.querySelector(`input[data-id="${CSS.escape(c.id)}"]`); if (!el) return;
    const a = norm(c.kind, el.value), e = norm(c.kind, c.expected);
    el.classList.remove('ok', 'bad', 'blank', 'solved');
    if (c.kind === 'queue') { const r = checkQueue(el.value, c.qinfo); if (r.ok) { right++; el.classList.add('ok'); } else { wrong++; el.classList.add('bad'); mistakes.push({ c, a: el.value || '(empty)', why: r.why }); } return; }
    if (a === e || (c.voidTok && a === '-')) { right++; el.classList.add('ok'); }
    else if (c.kind === 'data' && a === '') { blank++; el.classList.add('blank'); mistakes.push({ c, a: '(blank)' }); }
    else { wrong++; el.classList.add('bad'); mistakes.push({ c, a: el.value || (c.kind === 'queue' ? '(empty)' : '0') }); }
  });
  // strict
  if ($('#opt-strict').checked) $('#strict input[data-id]').forEach(el => {
    const a = norm('data', el.value), e = norm('data', el.dataset.expected); el.classList.remove('ok', 'bad', 'blank', 'solved');
    if (a === e) { right++; el.classList.add('ok'); } else if (a === '') { blank++; el.classList.add('blank'); } else { wrong++; el.classList.add('bad'); const [, key, n] = el.dataset.id.split('|'); mistakes.push({ c: { label: 'strict ' + key.split('/').slice(1).join('.'), n: +n, expected: el.dataset.expected, explain: () => 'In the strict design this register is computed every cycle from the values at n-1 with zero-latency channels and no bubbles.' }, a: el.value }); }
  });
  const total = right + wrong + blank; const pct = total ? right / total : 1;
  let html = `<div class="score ${pct === 1 ? 'good' : pct >= 0.7 ? 'mid' : 'low'}">${right} / ${total} correct` + (pct === 1 ? ' — the whole table is right.' : '') + `</div>`;
  if (mistakes.length) {
    mistakes.sort((p, q) => p.c.n - q.c.n);
    html += '<div class="mistakes">' + mistakes.map(m => `<div class="mistake"><span class="where">n=${m.c.n}, ${esc(m.c.label)}</span>: you wrote <b class="mono">${esc(m.a)}</b>, expected <b class="mono">${esc(m.c.expected === '' ? '(empty)' : m.c.expected)}</b>.<div class="exp">${esc(m.why ? m.why + ' ' : '')}${esc(m.c.explain())}</div></div>`).join('') + '</div>';
  }
  $('#results').innerHTML = html;
}
function reveal() {
  cells.filter(c => !c.given).forEach(c => { const el = document.querySelector(`input[data-id="${CSS.escape(c.id)}"]`); if (el) { el.value = c.expected; answers[c.id] = c.expected; el.classList.remove('ok', 'bad', 'blank'); el.classList.add('solved'); } });
  document.querySelectorAll('#strict input[data-id]').forEach(el => { el.value = el.dataset.expected; answers[el.dataset.id] = el.value; el.classList.remove('ok', 'bad', 'blank'); el.classList.add('solved'); });
  saveState(); $('#results').innerHTML = '<div class="hint">Solution revealed. Use “Explain cycle by cycle” to see why each row comes out this way.</div>';
}

/* ---------- explanations ---------- */
function consumersOf(inputName) { return sim.E.shells.filter(sh => sh.inputs.some(i => !i.from && i.name === inputName)); }
function capOf(sh) { return sh.queueCap != null ? sh.queueCap : spec.queueCap; }
function explainInStop(name, n) {
  const r = sim.rows[n - 1]; const parts = [];
  consumersOf(name).forEach(sh => { const q = r.shells[sh.name].queues[name]; const C = capOf(sh);
    if (q.stopped) parts.push(`stop=1 on ${name}: at the start of n=${n} the ${name}-queue of ${sh.name} still holds [${fmtQ(q.residual)}], which is its full capacity (${C}), so the token ${fmt(q.arriving.d)} arriving at n=${n} is rejected and the environment repeats it at n=${n + 1}.`);
    else parts.push(`stop=0 on ${name}: at the start of n=${n} the ${name}-queue of ${sh.name} holds ${q.residual.length ? '[' + fmtQ(q.residual) + ']' : 'nothing'} (${q.residual.length} of ${C === INF ? '∞' : C} slots), so there is room for the arriving token.`); });
  return parts.join(' ');
}
function explainQueue(shName, inName, n) {
  const r = sim.rows[n - 1]; const rec = r.shells[shName]; const q = rec.queues[inName]; const C = capOf(sim.E.byName[shName]);
  let s = `Leftover from earlier cycles: ${q.residual.length ? '[' + fmtQ(q.residual) + ']' : 'nothing'}. `;
  const t = q.arriving;
  if (t.v) s += `At n=${n} a void token arrives on ${inName}; voids are never stored. `;
  else if (q.stopped) s += `At n=${n} the valid token ${fmt(t.d)} arrives but the queue is full (${C}) and stop=1, so it is rejected. `;
  else if (q.bypass) s += `At n=${n} the valid token ${fmt(t.d)} arrives, the queue is empty and the shell fires, so it bypasses the queue and is consumed directly (not stored). `;
  else s += `At n=${n} the valid token ${fmt(t.d)} arrives and is stored behind the others. `;
  s += `Contents at n=${n}: ${q.shown.length ? '[' + fmtQ(q.shown) + ']' : 'empty'}. `;
  s += rec.fired ? `The shell fires at n=${n} and pops the head${q.shown.length ? ' (' + fmt(q.shown[0]) + ')' : ''}, leaving ${q.after.length ? '[' + fmtQ(q.after) + ']' : 'nothing'} for n=${n + 1}.` : `The shell ${rec.reason}, so nothing is popped: [${fmtQ(q.after)}] carries over to n=${n + 1}.`;
  return s;
}
function explainReg(shName, regName, n) {
  if (n === 1) return 'Initial value.';
  const prev = sim.rows[n - 2].shells[shName]; const sh = sim.E.byName[shName]; const rg = sh.regs.find(r => r.name === regName);
  if (prev.fired) {
    const used = Object.entries(prev.inputsUsed).map(([k, v]) => k + '=' + fmt(v)).concat(sh.regs.map(r => r.name + '=' + fmt(prev.regs[r.name]))).join(', ');
    return `${shName} fires at n=${n - 1} (${prev.reason.replace(/^fires: /, '')}), so ${regName}(${n}) = ${rg.expr} evaluated at n=${n - 1} with ${used} = ${fmt(sim.rows[n - 1].shells[shName].regs[regName])}.`;
  }
  return `${shName} ${prev.reason} at n=${n - 1}, so its core does not compute: ${regName} keeps the value it had at n=${n - 1} (${fmt(prev.regs[regName])}).`;
}
function explainSegD(ch, k, n) {
  if (n === 1) return 'Initial value.';
  if (k === 0) return explainReg(ch.src.shell, ch.src.reg, n) + ' The channel carries the register value.';
  return `Relay station ${k} at n=${n - 1}: ${sim.rows[n - 2].rsEvents[ch.id + '/' + k]}.`;
}
function explainSegV(ch, k, n) {
  if (n === 1) return 'Initial value.';
  if (k > 0) return `Relay station ${k} at n=${n - 1}: ${sim.rows[n - 2].rsEvents[ch.id + '/' + k]}. A relay station repeats the void bit of the token it forwards, and a repeated (stopped) token is valid.`;
  const prev = sim.rows[n - 2].shells[ch.src.shell]; const o = ch.src.reg;
  if (prev.fired) return `void=0 because ${ch.src.shell} fires at n=${n - 1} and produces a fresh token on ${o}.`;
  if (prev.chStops[ch.id] && !prev.chVoid[ch.id]) return `void=0: at n=${n - 1} the valid token ${o}=${fmt(prev.regs[o])} was stopped on this channel (stop=1), so this receiver did not sample it and the shell must repeat it as a valid token at n=${n}.`;
  const other = sim.E.channels.find(c => c.id !== ch.id && c.src.shell === ch.src.shell && c.src.reg === o && prev.chStops[c.id] && !prev.chVoid[c.id]);
  if (other) return `void=1: ${ch.src.shell} stalls at n=${n - 1} because the same token ${o}=${fmt(prev.regs[o])} was stopped on its other channel (${segLabel(other, 0)}); this receiver did sample it at n=${n - 1}, so the repeat is marked void here to avoid double sampling, while it is valid on the stopped channel.`;
  return `void=1 because ${ch.src.shell} ${prev.reason} at n=${n - 1}; the token on ${o} is repeated but it was already sampled by the receiver at n=${n - 1}, so it is marked void to avoid double sampling.`;
}
function explainSegS(ch, k, n) {
  const r = sim.rows[n - 1];
  if (k < ch.rs) { const st = r.segs[ch.id + '/' + k].s; return st ? `stop=1: relay station ${k + 1} is in the stalling state at n=${n} (it holds two valid tokens because its own output was stopped), so it rejects the token arriving now.` : `stop=0: relay station ${k + 1} is in the processing state at n=${n} and can accept a token.`; }
  if (ch.dst.kind === 'env') return 'Given by the environment.';
  const q = r.shells[ch.dst.shell].queues[ch.dst.input]; const C = capOf(sim.E.byName[ch.dst.shell]);
  return q.stopped ? `stop=1: at the start of n=${n} the ${ch.dst.input}-queue of ${ch.dst.shell} still holds [${fmtQ(q.residual)}], its full capacity (${C}), so the token arriving at n=${n} is rejected and must be repeated at n=${n + 1}.`
    : `stop=0: at the start of n=${n} the ${ch.dst.input}-queue of ${ch.dst.shell} holds ${q.residual.length ? '[' + fmtQ(q.residual) + ']' : 'nothing'} (${q.residual.length} of ${C === INF ? '∞' : C} slots), so there is room.`;
}
function renderCycles() {
  const E = sim.E; const out = [];
  sim.rows.forEach(r => {
    const n = r.n; const L = [];
    E.primaryInputs.forEach(p => { const i = r.inputs[p.name]; L.push(`${p.name}: ${fmt(i.d)}${i.v ? ' (void)' : ''}${i.s ? ' — rejected (stop=1)' : ''}${i.how === 'repeat' ? ' (repeat of the token rejected at n-1)' : ''}`); });
    E.shells.forEach(sh => { const rec = r.shells[sh.name]; L.push(`${sh.name} ${rec.reason}.` + sh.inputs.map(i => { const q = rec.queues[i.name]; return q.shown.length ? ` ${i.name}-queue holds [${fmtQ(q.shown)}].` : ''; }).join('')); });
    E.channels.forEach(ch => { for (let k = 1; k <= ch.rs; k++) L.push(`RS${k} on ${ch.src.shell}.${ch.src.reg}: ${r.rsEvents[ch.id + '/' + k]}.`); });
    out.push(`<div class="c"><b>n=${n}</b> — ${L.map(esc).join('<br>')}</div>`);
  });
  $('#cycles').innerHTML = out.join('');
}

/* ---------- generator ---------- */
function rng(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return (s % 100000) / 100000; }; }
function hashSeed(str) { let h = 2166136261; for (const ch of str) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
function genStream(rand, N, vr, lo, hi, prev0) {
  const toks = []; let prev = prev0 == null ? lo : prev0;
  for (let i = 0; i < N; i++) {
    if (i > 0 && rand() < vr) toks.push(fmt(prev) + 'v');
    else { const v = lo + Math.floor(rand() * (hi - lo + 1)); toks.push(String(v)); prev = v; }
  }
  return toks.join(' ');
}
function genStops(rand, N, sr) { const a = []; for (let i = 0; i < N; i++) a.push((i >= 1 && i < N - 2 && rand() < sr) ? 1 : 0); return a.join(' '); }
/* Random netlist generator.
   Plan: 1) choose a chain-like DAG of shells with pre-assigned exported register names (A->a, B->b, ...),
   2) assign inputs (channels from earlier shells, primary inputs, optional feedback input 'f'),
   3) build registers per shell so that every input is used, with growth bounded (multiplication only between
      small primary inputs, feedback registers reduced mod 10), 4) emit the spec and VALIDATE it by parsing and
   simulating; the caller retries with fresh randomness if anything fails. */
function randomNetlist(rand, o) {
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const nS = o.nS; const names = ['A', 'B', 'C', 'D'].slice(0, nS); const expName = { A: 'a', B: 'b', C: 'c', D: 'd' };
  const internalPool = ['p', 'q', 'r', 's', 'g', 'h', 'k', 'm']; let ipi = 0;
  const primPool = ['x', 'y', 'w', 'u', 'v', 't', 'z']; let ppi = 0;
  const prim = {}; // name -> {sel, small}
  const shells = names.map(n => ({ name: n, inputs: [], regs: [], exported: expName[n] }));
  // 1-2: inputs
  shells.forEach((sh, si) => {
    if (si > 0) {
      const prev = shells[si - 1]; sh.inputs.push({ name: prev.exported, from: { shell: prev.name, reg: prev.exported }, rs: 0 });
      if (si > 1 && rand() < 0.35) { const other = shells[Math.floor(rand() * (si - 1))]; sh.inputs.push({ name: other.exported, from: { shell: other.name, reg: other.exported }, rs: 0 }); }
    }
    const nPrim = si === 0 ? (rand() < 0.6 ? 2 : 3) : (rand() < 0.55 ? 1 : (rand() < 0.5 ? 0 : 2));
    for (let k = 0; k < nPrim && ppi < primPool.length; k++) { const n = primPool[ppi++]; prim[n] = { sel: false, small: false }; sh.inputs.push({ name: n, from: null, rs: 0 }); }
  });
  // feedback edge: a later shell exports an extra register f to an earlier shell
  let fbFrom = null, fbTo = null;
  if (o.fb && nS > 1) {
    const ti = Math.floor(rand() * (nS - 1)); fbTo = shells[ti]; fbFrom = shells[ti + 1 + Math.floor(rand() * (nS - ti - 1))];
    fbTo.inputs.push({ name: 'f', from: { shell: fbFrom.name, reg: 'f' }, rs: 0, fb: true });
  }
  // 3: registers, built in shell order. Every register does exactly ONE operation (as in the course examples):
  //    a = x + y, z = w, m = a * z, c = z ? w : a. No nesting, no mod. Multiplication only between small primary inputs.
  const inLoop = (sh) => fbFrom && (shells.indexOf(sh) >= shells.indexOf(fbTo) && shells.indexOf(sh) <= shells.indexOf(fbFrom));
  shells.forEach(sh => {
    const inNames = sh.inputs.map(i => i.name);
    const loop = inLoop(sh);
    // inside a feedback loop keep values from growing: inputs that feed the loop are kept small, ops are + or -
    if (loop) inNames.forEach(n => { if (prim[n]) prim[n].small = true; });
    const op2 = (a, b) => {
      const ops = loop ? ['+', '-'] : ['+', '+', '-'];
      if (!loop && prim[a] && prim[b] && rand() < 0.4) { prim[a].small = true; prim[b].small = true; return a + ' * ' + b; }
      return a + ' ' + pick(ops) + ' ' + b;
    };
    const rn = () => internalPool[ipi++];
    let e;
    if (inNames.length === 1) {
      e = rand() < 0.5 ? inNames[0] : inNames[0] + ' ' + pick(['+ 1', '- 1']);
    } else if (inNames.length === 2) {
      const [a, b] = inNames;
      if (rand() < 0.35) { const p = rn(); sh.regs.push({ name: p, expr: a === b ? a : op2(a, b), init: Math.floor(rand() * 4) }); e = op2(p, pick([a, b])); } // two-stage like HW3
      else e = op2(a, b);
    } else { // 3 inputs
      const [a, b, c] = inNames; const sel = inNames.find(n => prim[n]);
      const r = rand();
      if (sel && r < 0.3 && !loop) { prim[sel].sel = true; const rest = inNames.filter(n => n !== sel); e = sel + ' ? ' + rest[0] + ' : ' + rest[1]; }
      else if (r < 0.65) { const p = rn(); sh.regs.push({ name: p, expr: op2(a, b), init: Math.floor(rand() * 4) }); e = op2(p, c); }           // p = a op b ; out = p op c
      else { const p = rn(), q2 = rn(); sh.regs.push({ name: p, expr: op2(a, b), init: Math.floor(rand() * 4) }); sh.regs.push({ name: q2, expr: c, init: Math.floor(rand() * 4) }); e = op2(p, q2); } // HW3 shape: p = a op b ; q = c ; out = p op q
    }
    sh.regs.push({ name: sh.exported, expr: e, init: Math.floor(rand() * 4) });
    if (sh === fbFrom) { const src = pick([sh.exported, ...inNames]); sh.regs.push({ name: 'f', expr: src + ' ' + pick(['- 1', '+ 1', '- 2']), init: Math.floor(rand() * 3) }); }
  });
  // relay stations on channels (never on primary inputs)
  const chans = []; shells.forEach(sh => sh.inputs.forEach(i => { if (i.from) chans.push(i); }));
  let rsPlaced = 0;
  if (o.rs && chans.length) { pick(chans).rs = 1; rsPlaced = 1; if (chans.length > 1 && rand() < 0.4) { const c = pick(chans.filter(c => !c.rs)); if (c) { c.rs = 1; rsPlaced = 2; } } }
  // emit
  const L = [];
  shells.forEach(sh => {
    L.push(''); L.push('shell ' + sh.name);
    sh.inputs.forEach(i => L.push('  in ' + i.name + (i.from ? ' <- ' + i.from.shell + '.' + i.from.reg + (i.rs ? ' rs ' + i.rs : '') : '')));
    sh.regs.forEach(r => L.push('  reg ' + r.name + ' = ' + r.expr + ' init ' + r.init));
  });
  const last = shells[nS - 1]; const outName = last.exported === 'f' ? 'out' : last.exported;
  L.push(''); L.push('output ' + outName + ' = ' + last.name + '.' + last.exported); L.push('');
  Object.keys(prim).forEach(n => { const inf = prim[n]; L.push(n + ': ' + (inf.sel ? Array.from({ length: o.N }, () => (rand() < 0.3 ? '1' : '0')).join(' ') : genStream(rand, o.N, o.vr, 0, inf.small ? 3 : 9))); });
  L.push('stop ' + outName + ': ' + genStops(rand, o.N, o.sr));
  return { text: L.join('\n'), summary: nS + ' shell' + (nS > 1 ? 's' : '') + (fbFrom ? ', feedback ' + fbFrom.name + '→' + fbTo.name : '') + (rsPlaced ? ', ' + rsPlaced + ' relay station' + (rsPlaced > 1 ? 's' : '') : '') };
}
function validNetlist(text) {
  try { const sp = LID.parseSpec(text); const r = LID.simulate(sp);
    // every value finite and reasonably small; no shell that never fires; no NaN
    let ok = true; r.rows.forEach(row => Object.values(row.shells).forEach(sh => Object.values(sh.regs).forEach(v => { if (v !== null && (!Number.isFinite(v) || Math.abs(v) > 60)) ok = false; })));
    r.E.shells.forEach(sh => { if (!r.rows.some(row => row.shells[sh.name].fired)) ok = false; });
    return ok;
  } catch (e) { return false; }
}
function generate() {
  const seedStr = $('#g-seed').value.trim() || String(Date.now() % 1000000);
  const rand = rng(hashSeed(seedStr)); const N = Math.max(6, Math.min(25, +$('#g-cycles').value || 12));
  const vr = (+$('#g-void').value || 0) / 100, sr = (+$('#g-stop').value || 0) / 100;
  // templates: name -> {shells, feedback, rs}
  const TPL = { hw3: { shells: 1, fb: false, rs: false }, one2: { shells: 1, fb: false, rs: false }, pipe: { shells: 2, fb: false, rs: true }, chain: { shells: 2, fb: false, rs: false }, loop: { shells: 2, fb: true, rs: true }, loop0: { shells: 2, fb: true, rs: false }, fork: { shells: 3, fb: false, rs: true }, mac: { shells: 3, fb: true, rs: false }, macrs: { shells: 3, fb: true, rs: true } };
  const wantS = $('#g-shells').value, wantF = $('#g-feedback').value, wantR = $('#g-rs').value;
  let pool = Object.keys(TPL).filter(k => (wantS === 'any' || TPL[k].shells === +wantS) && (wantF === 'any' || TPL[k].fb === (wantF === 'yes')) && (wantR === 'any' || TPL[k].rs === (wantR === 'yes')));
  if (!pool.length) pool = Object.keys(TPL).filter(k => wantS === 'any' || TPL[k].shells === +wantS);
  const tpl = pool[Math.floor(rand() * pool.length)];
  let q = $('#g-queue').value; if (q === 'rand') q = ['2', '2', '3', 'inf'][Math.floor(rand() * 4)];
  if ($('#g-structure').value === 'random') {
    const nS = wantS === 'any' ? 1 + Math.floor(rand() * 3) : +wantS;
    const fb = wantF === 'any' ? (nS > 1 && rand() < 0.5) : (wantF === 'yes' && nS > 1);
    const rs = wantR === 'any' ? (nS > 1 && rand() < 0.5) : (wantR === 'yes' && nS > 1);
    for (let attempt = 0; attempt < 25; attempt++) {
      const r = randomNetlist(rand, { nS, fb, rs, N, vr, sr });
      const text = `# Generated exercise (seed ${seedStr}, random netlist: ${r.summary})\ncycles ${N}\nqueue ${q}\n` + r.text;
      if (validNetlist(text)) { $('#spec').value = text; $('#g-seed').value = ''; build(text); return; }
    }
    // fall through to a course template if no valid random netlist was found
  }
  const head = `# Generated exercise (seed ${seedStr}, topology ${tpl})\ncycles ${N}\nqueue ${q}\n`;
  let body = '';
  if (tpl === 'hw3') body = `
shell S
  in x
  in y
  in w
  reg a = x + y init ${Math.floor(rand() * 5)}
  reg z = w init ${Math.floor(rand() * 5)}
  reg m = a * z init -

output m = S.m

x: ${genStream(rand, N, vr, 0, 9)}
y: ${genStream(rand, N, vr, 0, 9)}
w: ${genStream(rand, N, vr, 0, 9)}
stop m: ${genStops(rand, N, sr)}`;
  else if (tpl === 'mac') { const z = []; for (let i = 0; i < N; i++) z.push(rand() < 0.2 ? '1' : '0'); body = `
shell Mult
  in x
  in y
  reg p = x * y init 0

shell Add
  in p <- Mult.p
  in c <- Mux.c
  reg a = p + c init 0

shell Mux
  in a <- Add.a
  in w
  in z
  reg c = z ? w : a init 0

output a = Add.a

x: ${genStream(rand, N, vr, 0, 5)}
y: ${genStream(rand, N, vr, 0, 3)}
w: ${genStream(rand, N, 0, 0, 9)}
z: ${z.join(' ')}
stop a: ${genStops(rand, N, sr)}`; }
  else if (tpl === 'one2') body = `
shell S
  in x
  in y
  reg s = x + y init ${Math.floor(rand() * 5)}
  reg d = x - y init ${Math.floor(rand() * 5)}
  reg m = s * d init -

output m = S.m

x: ${genStream(rand, N, vr, 0, 9)}
y: ${genStream(rand, N, vr, 0, 9)}
stop m: ${genStops(rand, N, sr)}`;
  else if (tpl === 'chain') body = `
shell A
  in x
  in y
  reg p = x * y init 0

shell B
  in p <- A.p
  in w
  reg q = p + w init 0

output q = B.q

x: ${genStream(rand, N, vr, 0, 9)}
y: ${genStream(rand, N, vr, 0, 3)}
w: ${genStream(rand, N, vr, 0, 9)}
stop q: ${genStops(rand, N, sr)}`;
  else if (tpl === 'loop0') body = `
shell A
  in x
  in f <- B.g
  reg u = x + f init 0

shell B
  in u <- A.u
  reg g = u % 10 init 1

output y = B.g

x: ${genStream(rand, N, vr, 0, 9)}
stop y: ${genStops(rand, N, sr)}`;
  else if (tpl === 'macrs') { const z = []; for (let i = 0; i < N; i++) z.push(rand() < 0.2 ? '1' : '0'); body = `
shell Mult
  in x
  in y
  reg p = x * y init 0

shell Add
  in p <- Mult.p rs 1
  in c <- Mux.c
  reg a = p + c init 0

shell Mux
  in a <- Add.a
  in w
  in z
  reg c = z ? w : a init 0

output a = Add.a

x: ${genStream(rand, N, vr, 0, 5)}
y: ${genStream(rand, N, vr, 0, 3)}
w: ${genStream(rand, N, 0, 0, 9)}
z: ${z.join(' ')}
stop a: ${genStops(rand, N, sr)}`; }
  else if (tpl === 'pipe') body = `
shell A
  in x
  reg p = x + 1 init 0

shell B
  in p <- A.p rs 1
  in y
  reg q = p * y init 0

output q = B.q

x: ${genStream(rand, N, vr, 0, 9)}
y: ${genStream(rand, N, vr, 1, 3)}
stop q: ${genStops(rand, N, sr)}`;
  else if (tpl === 'loop') body = `
shell A
  in x
  in f <- B.g rs 1
  reg u = x + f init 0

shell B
  in u <- A.u
  reg g = u % 10 init 1

output y = B.g

x: ${genStream(rand, N, vr, 0, 9)}
stop y: ${genStops(rand, N, sr)}`;
  else body = `
shell A
  in x
  reg p = x + 1 init 0

shell B
  in p <- A.p rs 1
  reg q = p * 2 init 0

shell C
  in p <- A.p
  in q <- B.q
  reg r = p + q init 0

output r = C.r

x: ${genStream(rand, N, vr, 0, 9)}
stop r: ${genStops(rand, N, sr)}`;
  const text = head + body;
  $('#spec').value = text; $('#g-seed').value = '';
  build(text);
}
$('#btn-gen').addEventListener('click', generate);

/* ---------- autosave (per-browser convenience) ---------- */
const SAVE_KEY = 'lid-trainer-state-v1';
function saveState() { try { localStorage.setItem(SAVE_KEY, JSON.stringify({ spec: $('#spec').value, answers, queues: $('#opt-queues').checked })); } catch (e) { /* storage unavailable */ } }
function loadState() { try { const raw = localStorage.getItem(SAVE_KEY); return raw ? JSON.parse(raw) : null; } catch (e) { return null; } }
document.addEventListener('input', (e) => { if (e.target.matches('input[data-id], #spec')) saveState(); });
const _build = build; build = function (text) { _build(text); saveState(); };

/* ---------- boot ---------- */
const saved = loadState();
if (saved && saved.spec) {
  $('#spec').value = saved.spec; if (saved.queues === false) $('#opt-queues').checked = false;
  _build(saved.spec); if (sim) { answers = saved.answers || {}; renderTable(); renderStrict(); }
  if (!sim) { $('#example').value = 'hw3e'; $('#spec').value = EXAMPLES.hw3e; build(EXAMPLES.hw3e); }
} else { $('#example').value = 'hw3e'; $('#spec').value = EXAMPLES.hw3e; build(EXAMPLES.hw3e); }
window.scrollTo(0, 0);
})();
