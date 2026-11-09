/* ---------- animation view: schematic with geometry, token overlay, transport, narration ---------- */
(function () {
'use strict';
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
      case 'neg': return add({ kind: 'op', ast, label: '−', inputs: [visit(ast.a)], pins: [''] }).id;
      case 'not': return add({ kind: 'op', ast, label: '¬', inputs: [visit(ast.a)], pins: [''] }).id;
      case 'bin': return add({ kind: 'op', ast, label: OPSYM[ast.op] || ast.op, inputs: [visit(ast.a), visit(ast.b)], pins: ['', ''] }).id;
      case 'tern': return add({ kind: 'op', ast, label: 'MUX', inputs: [visit(ast.c), visit(ast.a), visit(ast.b)], pins: ['sel', '1', '0'] }).id;
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
      const slots = C === INF ? 3 : Math.min(C, 4); const sh_ = 7; const qx = p.x - QW / 2; n.geo = { qx, qy: p.y - (slots * sh_) / 2, slots, sh_, QW, x: p.x, y: p.y };
      svg += `<rect class="queue" x="${qx}" y="${p.y - (slots * sh_) / 2}" width="${QW}" height="${slots * sh_}" rx="1"/>`;
      for (let s = 1; s < slots; s++) svg += `<line class="wire" style="stroke:var(--muted);stroke-width:.8" x1="${qx}" y1="${p.y - (slots * sh_) / 2 + s * sh_}" x2="${qx + QW}" y2="${p.y - (slots * sh_) / 2 + s * sh_}"/>`;
      if (C === INF) svg += `<text class="pin" x="${p.x}" y="${p.y + (slots * sh_) / 2 + 9}" text-anchor="middle">∞</text>`;
      svg += `<text class="port" x="${qx - 4}" y="${p.y + 4}" text-anchor="end">${esc(n.label)}</text>`;
      n.geo.inD = `M0,${p.y} L${qx},${p.y}`; wires += `<path class="wire" d="${n.geo.inD}"/>`;
    } else if (n.kind === 'const') {
      svg += `<text class="const" x="${p.x + 6}" y="${p.y + 4}" text-anchor="end">${esc(n.label)}</text>`;
    } else if (n.kind === 'op') {
      if (n.label === 'MUX') svg += `<path class="op" data-op="${esc(sh.name)}/${n.id}" d="M${p.x - 11},${p.y - 16} L${p.x + 11},${p.y - 9} L${p.x + 11},${p.y + 9} L${p.x - 11},${p.y + 16} Z"/><text class="oplabel" style="font-size:8px" x="${p.x}" y="${p.y + 3}" text-anchor="middle">MUX</text>`;
      else svg += `<circle class="op" data-op="${esc(sh.name)}/${n.id}" cx="${p.x}" cy="${p.y}" r="13"/><text class="oplabel" x="${p.x}" y="${p.y + 4}" text-anchor="middle">${esc(n.label)}</text>`;
    } else if (n.kind === 'ff') {
      svg += `<rect class="ff" data-ff="${esc(sh.name)}.${esc(n.label)}" x="${p.x - 10}" y="${p.y - 14}" width="20" height="28" rx="2"/><path class="clk" d="M${p.x - 4},${p.y + 12} L${p.x + 4},${p.y + 12} L${p.x},${p.y + 5} Z"/><text class="fflabel" x="${p.x + 12}" y="${p.y - 9}">${esc(n.label)}</text>`;
    } else if (n.kind === 'out') {
      n.geo = { x: p.x, y: p.y, outD: `M${p.x},${p.y} L${W},${p.y}` }; wires += `<path class="wire" d="${n.geo.outD}"/>`;
    }
  });
  // wires
  const pinY = (n, k) => { let y = pos[n.id].y; if (n.inputs.length > 1) y += (k - (n.inputs.length - 1) / 2) * (n.label === 'MUX' ? 9 : 8); return y; };
  edges.forEach(e => {
    const dst = byId[e.dst]; const y2 = pinY(dst, e.k); const x2 = inX(dst);
    if (dst.pins && dst.pins[e.k]) svg += `<text class="pin" x="${x2 + 3}" y="${y2 + 3}">${esc(dst.pins[e.k])}</text>`;
    const arrow = dst.kind === 'out' ? '' : ' marker-end="url(#aarr)"';
    if (e.feedback) {
      const s = byId[e.src]; const x1 = outX(s), y1 = pos[s.id].y; const yb = H - 10 - (edges.indexOf(e) % 3) * 6;
      e.d = `M${x1},${y1} L${x1 + 10},${y1} L${x1 + 10},${yb} L${x2 - 14},${yb} L${x2 - 14},${y2} L${x2},${y2}`;
      wires += `<path class="wire" d="${e.d}"${arrow}/>`; return;
    }
    // polyline through the dummies: source -> d1 -> ... -> destination pin, smooth between columns
    const pts = e.chain.map((id, i) => { const n = byId[id]; if (i === 0) return [outX(n), pos[id].y]; if (i === e.chain.length - 1) return [x2, y2]; return [pos[id].x, pos[id].y]; });
    let d = `M${pts[0][0]},${pts[0][1]}`;
    for (let i = 1; i < pts.length; i++) { const [xa, ya] = pts[i - 1], [xb, yb] = pts[i]; if (Math.abs(ya - yb) < 0.5) d += ` L${xb},${yb}`; else { const cx = (xa + xb) / 2; d += ` L${cx},${ya} L${cx},${yb} L${xb},${yb}`; } }
    e.d = d; wires += `<path class="wire" d="${d}"${arrow}/>`;
  });
  const regY = {}; sh.regs.forEach(r => { regY[r.name] = pos['out:' + r.name] ? pos['out:' + r.name].y : pos['ff:' + r.name].y; });
  const portY = {}; sh.inputs.forEach(i => { portY[i.name] = pos['in:' + i.name].y; });
  svg = `<rect class="shellbox" x="8" y="2" width="${W - 16}" height="${H - 4}" rx="10"/><text class="shelllabel" x="16" y="14">shell ${esc(sh.name)}</text>` + wires + svg;
  return { W, H, svg, portY, regY, nodes, edges, pos, byId, outX, inX };
}
/* ---------- schematic with recorded geometry (same layout as the trainer) ---------- */
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
  const COLGAP = 130, ROWGAP = 56, PAD = 70;
  const pos = {}; let maxH = 0, x = PAD; const colKeys = Object.keys(cols).sort((a, b) => a - b);
  colKeys.forEach(l => { let y = PAD / 2 + 10; const cw = Math.max(...cols[l].map(i => sch[i].W)); cols[l].forEach(i => { pos[i] = { x, y }; y += sch[i].H + ROWGAP; }); maxH = Math.max(maxH, y); x += cw + COLGAP; });
  const W = x - COLGAP + 150, H = maxH + 30;
  geo = { W, H, shells: {}, envIn: [], channels: {} };
  let svg = '';
  shells.forEach((sh, i) => { geo.shells[sh.name] = { x: pos[i].x, y: pos[i].y, sch: sch[i], W: sch[i].W, H: sch[i].H }; svg += `<g transform="translate(${pos[i].x},${pos[i].y})" data-shell="${esc(sh.name)}">${sch[i].svg}<g class="ovs" data-ovs="${esc(sh.name)}"></g></g>`; });
  shells.forEach((sh, i) => sh.inputs.forEach(inp => { if (inp.from) return; const y = pos[i].y + sch[i].portY[inp.name]; const node = sch[i].byId['in:' + inp.name];
    const qx = pos[i].x + node.geo.qx; geo.envIn.push({ shell: sh.name, input: inp.name, x0: pos[i].x - 46, x1: qx, y });
    svg += `<path class="wire" d="M${pos[i].x - 40},${y} L${pos[i].x},${y}"/><text class="chan" x="${pos[i].x - 64}" y="${y + 4}" text-anchor="end">${esc(inp.name)}</text>`; }));
  E.channels.forEach(c => {
    const si = idx[c.src.shell]; const x1 = pos[si].x + sch[si].W, y1 = pos[si].y + sch[si].regY[c.src.reg];
    let x2, y2, d, rsPts = [];
    if (c.dst.kind === 'env') {
      const xEnd = W - 80; const maxLevel = Math.max(...level);
      if (level[si] === maxLevel) { x2 = xEnd; y2 = y1; d = `M${x1},${y1} L${x2},${y2}`; for (let k = 1; k <= c.rs; k++) rsPts.push([x1 + (x2 - x1) * k / (c.rs + 1), y1]); }
      else { const yt = 14 + (c.id % 3) * 8; x2 = xEnd; y2 = yt; d = `M${x1},${y1} L${x1 + 16},${y1} L${x1 + 16},${yt} L${x2},${yt}`; for (let k = 1; k <= c.rs; k++) rsPts.push([(x1 + 16) + (x2 - x1 - 16) * k / (c.rs + 1), yt]); }
      svg += `<text class="chan" x="${x2 + 6}" y="${y2 + 4}">${esc(c.dst.name)} (output)</text>`;
    } else {
      const di = idx[c.dst.shell]; x2 = pos[di].x; y2 = pos[di].y + sch[di].portY[c.dst.input];
      if (x2 > x1 && level[di] - level[si] > 1) { const yt = 14 + (c.id % 3) * 8; d = `M${x1},${y1} L${x1 + 16},${y1} L${x1 + 16},${yt} L${x2 - 16},${yt} L${x2 - 16},${y2} L${x2},${y2}`; for (let k = 1; k <= c.rs; k++) rsPts.push([(x1 + 16) + ((x2 - 16) - (x1 + 16)) * k / (c.rs + 1), yt]); }
      else if (x2 > x1) { const cx = (x1 + x2) / 2; d = `M${x1},${y1} L${cx},${y1} L${cx},${y2} L${x2},${y2}`; for (let k = 1; k <= c.rs; k++) { const t = k / (c.rs + 1); rsPts.push(t <= 0.5 ? [x1 + (cx - x1) * (t * 2) * 0.8 + 6, y1] : [cx + (x2 - cx) * ((t - 0.5) * 2) * 0.8 + 6, y2]); } }
      else { const yb = Math.max(pos[si].y + sch[si].H, pos[di].y + sch[di].H) + 24 + (c.id % 3) * 12; d = `M${x1},${y1} L${x1 + 22},${y1} L${x1 + 22},${yb} L${x2 - 22},${yb} L${x2 - 22},${y2} L${x2},${y2}`; for (let k = 1; k <= c.rs; k++) rsPts.push([(x1 + 22) + ((x2 - 22) - (x1 + 22)) * k / (c.rs + 1), yb]); }
    }
    // the destination of a shell channel is the queue inside the receiver, so the token track continues to it
    let dEnd = `${x2},${y2}`;
    if (c.dst.kind === 'shell') { const di = idx[c.dst.shell]; const node = sch[di].byId['in:' + c.dst.input]; dEnd = `${pos[di].x + node.geo.qx},${y2}`; }
    geo.channels[c.id] = { d: d + ' L' + dEnd, rsPts, x1, y1, x2, y2 };
    svg += `<path class="wire" d="${d}" marker-end="url(#aarr)"/>`;
    rsPts.forEach(([px, py], k) => { svg += `<rect class="rs" data-rs="${c.id}/${k + 1}" x="${px - 11}" y="${py - 9}" width="22" height="18" rx="2"/><text class="rslabel" x="${px}" y="${py + 3.5}" text-anchor="middle">RS</text>`; });
  });
  return `<svg viewBox="0 0 ${W} ${H}" width="${W * 1.45}" height="${H * 1.45}" role="img" aria-label="Animated schematic of the shells, queues, flip-flops, channels and relay stations"><defs><marker id="aarr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="currentColor"/></marker></defs><g style="color:var(--fg)">${svg}<g id="a-tracks"></g><g id="a-ov"></g></g></svg>`;
}

/* ---------- state ---------- */
let spec = null, sim = null, geo = null, tracks = null, auxAt = null;
let cur = 1, tt = 0, playing = false, raf = 0, lastTs = 0, phaseTimer = 0, mode = 'hold';
const $ = (s) => document.querySelector(s);
const fmt = LID.fmtVal; const INF = LID.INF;
function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
const SVGNS = 'http://www.w3.org/2000/svg';
const HOLD = 1400, DUR = 3000;
// phases of the transition n -> n+1 (fractions of DUR)
const PH = { travel: [0, 0.40], settle: [0.40, 0.50], core: [0.50, 0.88], commit: [0.88, 1] };
const ph = (t, [a, b]) => Math.max(0, Math.min(1, (t - a) / (b - a)));
const ease = (u) => u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;

/* ---------- build ---------- */
function build(text) {
  $('#a-err').textContent = '';
  try { spec = LID.parseSpec(text); sim = LID.simulate(spec); }
  catch (e) { $('#a-err').textContent = e.message; return false; }
  stop();
  $('#a-schematic').innerHTML = drawSchematic();
  makeTracks(); computeAux();
  cur = 1; tt = 0;
  $('#a-scrub').max = spec.cycles; $('#a-scrub').value = 1; $('#a-cyc-N').textContent = '/ ' + spec.cycles;
  renderTable(); frame();
  return true;
}
function makeTracks() {
  const svg = $('#a-schematic svg'); const g = svg.querySelector('#a-tracks'); g.innerHTML = '';
  tracks = { ch: {}, env: [], edges: {} };
  const mk = (d, parent) => { const p = document.createElementNS(SVGNS, 'path'); p.setAttribute('class', 'track'); p.setAttribute('d', d); parent.appendChild(p); return p; };
  const nearest = (p, pt) => { const L = p.getTotalLength(); let best = 0, bd = 1e9; for (let s = 0; s <= L; s += 2) { const q = p.getPointAtLength(s); const d = (q.x - pt[0]) ** 2 + (q.y - pt[1]) ** 2; if (d < bd) { bd = d; best = s; } } return best; };
  sim.E.channels.forEach(c => { const gc = geo.channels[c.id]; const p = mk(gc.d, g); const L = p.getTotalLength(); const cuts = [0, ...gc.rsPts.map(pt => nearest(p, pt)), L]; tracks.ch[c.id] = { p, cuts, L }; });
  geo.envIn.forEach(e => { const p = mk(`M${e.x0},${e.y} L${e.x1},${e.y}`, g); tracks.env.push({ ...e, p, L: p.getTotalLength() }); });
  Object.keys(geo.shells).forEach(name => { const G = geo.shells[name]; const gs = svg.querySelector(`g[data-shell="${CSS.escape(name)}"]`); tracks.edges[name] = G.sch.edges.map(e => { if (!e.d) return null; const p = mk(e.d, gs); return { e, p, L: p.getTotalLength() }; }).filter(Boolean); });
}
// aux token of each relay station at each cycle (derived from the stop bits it raises)
function computeAux() {
  auxAt = sim.rows.map(() => ({}));
  sim.E.channels.forEach(c => { for (let k = 1; k <= c.rs; k++) { let aux = null; sim.rows.forEach((r, i) => { const stalling = r.segs[c.id + '/' + (k - 1)].s; if (stalling && aux === null && i > 0) aux = sim.rows[i - 1].segs[c.id + '/' + (k - 1)].d; if (!stalling) aux = null; auxAt[i][c.id + '/' + k] = stalling ? { d: aux } : null; }); } });
}
const capOf = (sh) => sh.queueCap != null ? sh.queueCap : spec.queueCap;
const segPt = (cid, k, f) => { const tr = tracks.ch[cid]; const a = tr.cuts[k], b = tr.cuts[k + 1]; return tr.p.getPointAtLength(a + (b - a) * f); };
const bounce = (f, lim = 0.72) => f < 0.5 ? lim * ease(f * 2) : lim * (1 - ease((f - 0.5) * 2)); // out and back

/* ---------- drawing ---------- */
function chip(x, y, val, cls) { const s = fmt(val) === '-' ? '–' : fmt(val); const w = Math.max(18, s.length * 7 + 10); return `<g class="chip ${cls || ''}" transform="translate(${x.toFixed(1)},${y.toFixed(1)})"><rect x="${-w / 2}" y="-8" width="${w}" height="16" rx="4"/><text x="0" y="3.6" text-anchor="middle">${esc(s)}</text></g>`; }
function stopMark(x, y, dir, label) { // dir: -1 token comes from the left, marker faces back
  const dx = dir * 6; return `<g><path class="stopm" d="M${x - dx},${y - 7} L${x - dx},${y + 7} M${x - dx},${y} L${x - dx - dir * 10},${y}"/><text class="stopt" x="${x - dx - dir * 12}" y="${y - 6}" text-anchor="${dir > 0 ? 'end' : 'start'}">${esc(label || 'stop')}</text></g>`;
}
function queueSvg(G, node, list, headConsumed, flash) {
  const g = node.geo; let s = ''; const n = list.length; const show = Math.min(n, g.slots);
  for (let i = 0; i < show; i++) { const y = g.qy + i * g.sh_; const v = (i === g.slots - 1 && n > g.slots) ? '+' + (n - g.slots + 1) : fmt(list[i]); s += `<rect class="qfill" x="${g.qx + 0.5}" y="${y + 0.5}" width="${g.QW - 1}" height="${g.sh_ - 1}"/><text class="qv${i === 0 ? ' head' : ''}" x="${g.x}" y="${y + 5.3}" text-anchor="middle">${esc(v === '-' ? '–' : v)}</text>`; }
  if (headConsumed && n) s += `<path class="stopm" style="stroke:var(--ok);stroke-width:1.2" d="M${g.qx - 2},${g.qy + g.sh_ - 1} L${g.qx + g.QW + 2},${g.qy + 1}"/>`;
  return s;
}
function nodeValue(G, node, rec, sh) {
  switch (node.kind) {
    case 'in': return rec.inputsUsed[node.label];
    case 'const': return Number(node.label);
    case 'ff': return rec.regs[node.label];
    case 'op': { const env = { ...rec.regs, ...rec.inputsUsed }; try { return LID.evalAst(node.ast, env); } catch (e) { return null; } }
    default: return null;
  }
}
function shortReason(sh, rec) {
  const missing = sh.inputs.filter(i => rec.queues[i.name].residual.length === 0 && rec.inEvents[i.name] !== 'accepted').map(i => i.name);
  const blocked = Object.keys(rec.outStops).filter(o => sim.E.channels.some(c => c.src.shell === sh.name && c.src.reg === o && rec.chStops[c.id] && !rec.chVoid[c.id]));
  const parts = []; if (missing.length) parts.push('waits for ' + missing.join(', ')); if (blocked.length) parts.push(blocked.join(', ') + ' stopped');
  return parts.join('; ') || 'stalls';
}

/* draw the whole overlay for cycle n at transition progress t (0 = state at n, 1 = state at n+1) */
function render(n, t) {
  const E = sim.E; const r = sim.rows[n - 1]; const r2 = sim.rows[n] || null; const trans = t > 0 && r2;
  const pT = trans ? ease(ph(t, PH.travel)) : 0, pS = trans ? ph(t, PH.settle) : 0, pC = trans ? ph(t, PH.core) : 0, pD = trans ? ph(t, PH.commit) : 0;
  const showCore = $('#a-opt-core').checked;
  let ov = '';
  const svg = $('#a-schematic svg');
  // --- shells: queues, flip-flops, badges, core flow ---
  E.shells.forEach(sh => {
    const G = geo.shells[sh.name]; const rec = r.shells[sh.name]; const rec2 = r2 && r2.shells[sh.name];
    let os = '';
    sh.inputs.forEach(i => {
      const node = G.sch.byId['in:' + i.name]; const q = rec.queues[i.name];
      let list = q.residual, consumed = false;
      if (trans) {
        if (pS > 0) list = q.shown;                          // arrival stored (unless bypassed)
        if (rec.fired && pC > 0) { list = pC >= 1 ? q.after : q.shown; consumed = pC < 1 && q.shown.length > 0; }
        if (pD >= 1) list = q.after;
      }
      os += queueSvg(G, node, list, consumed);
      // residual-full marker: this input raises stop at n
      if (q.stopped && (!trans || pS < 1)) os += stopMark(node.geo.qx - 2, node.geo.y, 1, 'stop');
    });
    // flip-flop values
    sh.regs.forEach(rg => { const node = G.sch.byId['ff:' + rg.name]; const p = G.sch.pos[node.id]; const flash = trans && pD > 0 && rec.fired; const v = (trans && pD > 0) ? rec2.regs[rg.name] : rec.regs[rg.name]; os += `<text class="ffv${flash ? ' flash' : ''}" x="${p.x + 12}" y="${p.y + 8}">${esc(fmt(v) === '-' ? '–' : fmt(v))}</text>`; });
    // badge
    const fired = rec.fired; const label = fired ? 'fires' : shortReason(sh, rec);
    const bw = label.length * 5.4 + 12;
    if (!trans || pD < 1) os += `<g class="badge ${fired ? 'ok' : 'bad'}" transform="translate(${G.W - 12 - bw},${G.H - 18})"><rect x="0" y="0" width="${bw}" height="14"/><text x="${bw / 2}" y="10" text-anchor="middle">${esc(label)}</text></g>`;
    // core flow when it fires
    const hot = new Set();
    if (trans && fired && pC > 0 && pC < 1 && showCore) {
      tracks.edges[sh.name].forEach(({ e, p, L }) => {
        const src = G.sch.byId[e.src]; const dst = G.sch.byId[e.dst]; if (dst.kind === 'out') return;
        const v = nodeValue(G, src, rec, sh); if (v === undefined) return;
        // stagger by source level so values reach each operator in dataflow order
        const maxL = Math.max(1, ...G.sch.nodes.filter(nn => nn.kind !== 'out' && nn.kind !== 'dummy').map(nn => nn.level));
        const lvlS = src.kind === 'in' || src.kind === 'const' ? 0 : src.level; const a = lvlS / maxL, b = Math.min(1, (lvlS + 1) / maxL);
        const f = Math.max(0, Math.min(1, (pC - a) / (b - a))); if (f <= 0) return;
        const pt = p.getPointAtLength(L * ease(f));
        if (f >= 1 && dst.kind === 'op') { const vs = fmt(v) === '-' ? '–' : fmt(v); os += `<text class="corev" x="${(pt.x - 4).toFixed(1)}" y="${(pt.y + 3).toFixed(1)}" text-anchor="end">${esc(vs)}</text>`; }
        else os += chip(pt.x, pt.y, v, 'core');
        if (f >= 1 && dst.kind === 'op') hot.add(dst.id);
      });
    }
    const gs = svg.querySelector(`g[data-ovs="${CSS.escape(sh.name)}"]`); gs.innerHTML = os;
    svg.querySelectorAll(`[data-op^="${CSS.escape(sh.name)}/"]`).forEach(el => el.classList.toggle('hot', hot.has(el.dataset.op.split('/')[1])));
    svg.querySelectorAll(`[data-ff^="${CSS.escape(sh.name)}."]`).forEach(el => el.classList.toggle('flash', trans && pD > 0 && fired));
    const box = svg.querySelector(`g[data-shell="${CSS.escape(sh.name)}"] .shellbox`); if (box) box.style.fill = fired ? '' : 'color-mix(in srgb, var(--bad-soft) 55%, var(--surface))';
  });
  // --- primary inputs ---
  tracks.env.forEach(e => {
    const tok = r.inputs[e.input]; const rec = r.shells[e.shell]; const ev = rec.inEvents[e.input]; const q = rec.queues[e.input];
    const cls = tok.v ? 'void' : (ev === 'rejected' ? 'rej' : '');
    let f = 0, op = 1;
    if (trans) {
      if (ev === 'rejected') f = bounce(pT);
      else { f = pT; if (tok.v) op = 1 - Math.max(0, (pT - 0.75) / 0.25); }
      if (!tok.v && ev === 'accepted' && pT >= 1) { f = 1; op = q.bypass ? (pC > 0 ? 0 : 1) : 0; }
    }
    if (op > 0) { const pt = e.p.getPointAtLength(e.L * f); ov += `<g opacity="${op.toFixed(2)}">${chip(pt.x, pt.y, tok.d, cls)}</g>`; }
    if (trans && pD > 0 && r2) { const t2 = r2.inputs[e.input]; const pt = e.p.getPointAtLength(0); ov += `<g opacity="${pD.toFixed(2)}">${chip(pt.x, pt.y, t2.d, t2.v ? 'void' : '')}</g>`; }
    if (ev === 'rejected' && !trans) ov += `<text class="phase" x="${e.x0}" y="${e.y + 20}" text-anchor="middle">repeat at n+1</text>`;
  });
  // --- channels ---
  E.channels.forEach(c => {
    const tr = tracks.ch[c.id];
    for (let k = 0; k <= c.rs; k++) {
      const seg = r.segs[c.id + '/' + k];
      // outcome at the receiver of this segment
      let outcome;
      if (seg.v) outcome = 'void'; else if (seg.s) outcome = 'rejected'; else outcome = 'accepted';
      const cls = seg.v ? 'void' : (outcome === 'rejected' ? 'rej' : '');
      let f = 0, op = 1;
      const bypass = (k === c.rs && c.dst.kind === 'shell' && r.shells[c.dst.shell].queues[c.dst.input].bypass);
      if (trans) {
        if (outcome === 'rejected') f = bounce(pT);
        else { f = pT; if (seg.v) op = 1 - Math.max(0, (pT - 0.75) / 0.25); else if (pT >= 1) op = (bypass && pC <= 0) ? 1 : 0; }
      }
      if (op > 0) { const pt = segPt(c.id, k, f); ov += `<g opacity="${op.toFixed(2)}">${chip(pt.x, pt.y, seg.d, cls)}</g>`; }
      // stop marker at the receiver end
      if (seg.s && (!trans || pD < 1)) { const pe = segPt(c.id, k, 1); const lab = c.dst.kind === 'env' && k === c.rs ? 'stop (env)' : 'stop'; const pb = segPt(c.id, k, 0.9); const dir = pe.x >= pb.x ? 1 : -1; ov += stopMark(pe.x + (c.dst.kind === 'env' && k === c.rs ? 14 : 0), pe.y, dir, lab); }
      // next token appears at the sender during commit
      if (trans && pD > 0) { const s2 = r2.segs[c.id + '/' + k]; const pt = segPt(c.id, k, 0); ov += `<g opacity="${pD.toFixed(2)}">${chip(pt.x, pt.y, s2.d, s2.v ? 'void' : '')}</g>`; }
    }
    // relay stations: parked token and stalling state
    for (let k = 1; k <= c.rs; k++) {
      const key = c.id + '/' + k; const aux = (trans && pD > 0) ? auxAt[n] && auxAt[n][key] : auxAt[n - 1][key];
      const [px, py] = geo.channels[c.id].rsPts[k - 1];
      if (aux) { ov += chip(px, py + 20, aux.d, 'aux'); ov += `<text class="rsstate" x="${px}" y="${py + 34}" text-anchor="middle">stalling</text>`; }
    }
  });
  svg.querySelector('#a-ov').innerHTML = ov;
  // phase bar + readouts
  $('#a-phasefill').style.width = (trans ? t * 100 : 0) + '%';
  $('#a-cyc-n').textContent = 'n = ' + n + (trans ? ' → ' + (n + 1) : '');
  $('#a-phase').textContent = PHASE_TEXT(n, trans ? t : 0);
  $('#a-scrub').value = (trans ? n + t : n).toFixed(2);
  highlightRow(n);
}

/* ---------- explanation of the current cycle (below the stage) ---------- */
function segLabel(ch, k, long) {
  if (ch.dst.kind === 'env') return (long ? 'output ' : '') + ch.dst.name;
  const base = ch.src.reg + '→' + ch.dst.shell + '.' + ch.dst.input;
  if (ch.rs === 0) return base;
  return k === 0 ? ch.src.reg + '→RS1' : (k < ch.rs ? 'RS' + k + '→RS' + (k + 1) : 'RS' + k + '→' + ch.dst.shell + '.' + ch.dst.input);
}
const dash = (v) => { const s = fmt(v); return s === '-' ? '–' : s; };
function narrate(n) {
  const E = sim.E; const r = sim.rows[n - 1]; const r2 = sim.rows[n] || null;
  const A = [], B = [];
  // --- left: the state at n (what row n of the table says) ---
  A.push(`<h3>State at n = ${n} (row ${n} of the table)</h3>`);
  E.primaryInputs.forEach(p => { const i = r.inputs[p.name];
    A.push(`<div class="line in"><b>${esc(p.name)}</b>: ${i.v ? 'void token (bubble) — carries no data, nothing is stored' : 'valid token <span class="mono">' + esc(dash(i.d)) + '</span>'}${i.s ? ', but <b>stop = 1</b>: the queue is full, so it is <b>rejected</b> and the environment repeats it at n = ' + (n + 1) : ''}${i.how === 'repeat' ? ' (repeat of the token rejected at n = ' + (n - 1) + ')' : ''}${i.how === 'end' ? ' — the stream is over' : ''}.</div>`); });
  E.shells.forEach(sh => { const rec = r.shells[sh.name];
    const byp = sh.inputs.filter(i => rec.queues[i.name].bypass).map(i => i.name);
    const held = sh.inputs.filter(i => rec.queues[i.name].shown.length).map(i => `${i.name}-queue holds [${rec.queues[i.name].shown.map(dash).join(',')}]` + (rec.fired ? ', head consumed' : ''));
    const qs = held.concat(byp.length ? [byp.join(', ') + (byp.length > 1 ? ' arrive into empty queues and are' : ' arrives into an empty queue and is') + ' used directly (bypass)'] : []).join('; ');
    A.push(`<div class="line ${rec.fired ? 'fire' : 'stall'}"><b>${esc(sh.name)}</b> ${esc(rec.reason)}.${qs ? ' ' + esc(qs) + '.' : ''}</div>`); });
  E.channels.forEach(ch => { for (let k = 1; k <= ch.rs; k++) { const aux = auxAt[n - 1][ch.id + '/' + k];
    B.push(`<div class="line rs"><b>RS${k}</b> on ${esc(ch.src.shell + '.' + ch.src.reg)}: ${esc(r.rsEvents[ch.id + '/' + k])}${aux ? ' (parked token: ' + esc(dash(aux.d)) + ', stalling state)' : ''}.</div>`); } });
  // --- right: what happens during cycle n, i.e. how row n+1 comes out ---
  if (r2) {
    B.unshift(`<h3>During cycle ${n} → what row ${n + 1} will show</h3>`);
    E.shells.forEach(sh => { const rec = r.shells[sh.name], rec2 = r2.shells[sh.name];
      const regs = sh.regs.map(rg => `${rg.name} = ${dash(rec2.regs[rg.name])}`).join(', ');
      const outs = E.channels.filter(c => c.src.shell === sh.name).map(c => {
        const v2 = rec2.chVoid[c.id];
        const lab = esc(segLabel(c, 0, true)); const val = esc(dash(rec2.regs[c.src.reg]));
        if (rec.fired) return `${lab} carries the new token ${val} (void = 0)`;
        if (!v2) return `${lab} repeats ${val} as <b>valid</b> (void = 0): its receiver had stop = 1 and did not sample it`;
        return `${lab} repeats ${val} as <b>void</b> (void = 1): the receiver already sampled it at n = ${n}`;
      });
      const after = sh.inputs.map(i => { const q = rec.queues[i.name]; return q.after.length ? `${i.name}-queue → [${q.after.map(dash).join(',')}]` : ''; }).filter(Boolean).join(', ');
      if (rec.fired) { const used = sh.inputs.map(i => i.name + ' = ' + dash(rec.inputsUsed[i.name])).join(', ');
        B.push(`<div class="line fire"><b>${esc(sh.name)}</b> fires: the core computes with ${esc(used)} → <span class="mono">${esc(regs)}</span> at n = ${n + 1}. ${outs.join('; ')}.${after ? ' Left in the queues: ' + esc(after) + '.' : ''}</div>`); }
      else B.push(`<div class="line stall"><b>${esc(sh.name)}</b> stalls: the flip-flops hold (<span class="mono">${esc(regs)}</span>). ${outs.join('; ')}.${after ? ' Queues carry over: ' + esc(after) + '.' : ''}</div>`);
    });
    const nextIn = E.primaryInputs.map(p => { const t = r2.inputs[p.name]; return `${p.name} = ${t.v ? 'void' : dash(t.d)}${t.how === 'repeat' ? ' (the rejected token, repeated)' : ''}`; }).join(', ');
    if (nextIn) B.push(`<div class="line in">Environment at n = ${n + 1}: ${esc(nextIn)}.</div>`);
    B.push(`<div class="line next">Press <b>▶|</b> (or →) to watch cycle ${n} happen: tokens are sampled, queues accept or reject, shells fire or stall, and the flip-flops take their values for n = ${n + 1}.</div>`);
  } else {
    B.push('<h3>End of the trace</h3>');
    B.push(`<div class="line next">n = ${n} is the last row. Use ⏮ to start again, or click a row of the table.</div>`);
  }
  $('#a-narr').innerHTML = `<div class="ncyc">Cycle n = ${n} <small>of ${spec.cycles}</small></div><div class="cols2"><div>${A.join('')}</div><div>${B.join('')}</div></div>`;
}
const PHASE_TEXT = (n, t) => {
  if (!(t > 0) || n >= spec.cycles) return `State at n = ${n}: every value drawn is what row ${n} of the table contains.`;
  if (t < PH.travel[1]) return `Cycle ${n}, step 1 — tokens travel to their receivers; a token meeting stop = 1 bounces back to be repeated.`;
  if (t < PH.settle[1]) return `Cycle ${n}, step 2 — accepted tokens enter the queues (or bypass straight into a firing core); bubbles vanish.`;
  if (t < PH.core[1]) return `Cycle ${n}, step 3 — each shell that fires pops its queues and its core computes the next register values.`;
  return `Cycle ${n}, step 4 — flip-flops take their values for n = ${n + 1}; the new tokens appear at the senders.`;
};

/* ---------- the table, filled in up to the current cycle ---------- */
function qText(rec, inName) { const q = rec.queues[inName]; if (q.bypass) return '\\' + fmt(q.arriving.d); if (!q.shown.length) return ''; return (rec.fired ? '\\' : '') + q.shown.map(fmt).join(','); }
function renderTable() {
  const E = sim.E; const groups = [];
  const tokc = (d, v, s) => `<td>${esc(fmt(d))}<span class="g">(</span>${v}<span class="g">,</span>${s}<span class="g">)</span></td>`;
  const inCols = [];
  E.primaryInputs.forEach(p => { inCols.push({ title: p.name + '(v, s)', render: (r) => tokc(r.inputs[p.name].d, r.inputs[p.name].v, r.inputs[p.name].s) });
    E.shells.forEach(sh => sh.inputs.forEach(i => { if (!i.from && i.name === p.name) inCols.push({ title: 'q', cls: 'qc', render: (r) => `<td class="qc">${esc(qText(r.shells[sh.name], i.name))}</td>` }); })); });
  groups.push({ title: 'Input', cols: inCols });
  E.shells.forEach(sh => { const cols = sh.regs.filter(rg => !sh.outs.includes(rg.name)).map(rg => ({ title: rg.name, render: (r) => `<td>${esc(fmt(r.shells[sh.name].regs[rg.name]))}</td>` })); if (cols.length) groups.push({ title: (E.shells.length > 1 ? sh.name + ' ' : '') + 'internal', cols }); });
  const chanCols = [], outCols = [];
  E.channels.forEach(ch => { for (let k = 0; k <= ch.rs; k++) { const col = { title: segLabel(ch, k) + '(v, s)', render: (r) => { const s = r.segs[ch.id + '/' + k]; return tokc(s.d, s.v, s.s); } }; (ch.dst.kind === 'env' ? outCols : chanCols).push(col);
    if (k === ch.rs && ch.dst.kind === 'shell') chanCols.push({ title: 'q', cls: 'qc', render: (r) => `<td class="qc">${esc(qText(r.shells[ch.dst.shell], ch.dst.input))}</td>` }); } });
  if (chanCols.length) groups.push({ title: 'Channels', cols: chanCols });
  if (outCols.length) groups.push({ title: 'Output', cols: outCols });
  let h = '<thead><tr class="grp"><th rowspan="2">n</th>' + groups.map(g => `<th colspan="${g.cols.length}">${esc(g.title)}</th>`).join('') + '</tr><tr>' + groups.map(g => g.cols.map(c => `<th${c.cls ? ' class="' + c.cls + '"' : ''}>${esc(c.title)}</th>`).join('')).join('') + '</tr></thead><tbody>';
  sim.rows.forEach(r => { h += `<tr data-n="${r.n}"><td class="n">${r.n}</td>` + groups.map(g => g.cols.map(c => c.render(r)).join('')).join('') + '</tr>'; });
  $('#a-trace').innerHTML = h + '</tbody>';
  $('#a-trace').querySelectorAll('tr[data-n]').forEach(tr => tr.addEventListener('click', () => { stop(); goTo(+tr.dataset.n); }));
}
function highlightRow(n) {
  const showAll = $('#a-showall').checked;
  $('#a-trace').querySelectorAll('tr[data-n]').forEach(tr => { const m = +tr.dataset.n; tr.classList.toggle('cur', m === n); tr.classList.toggle('past', m < n); tr.classList.toggle('future', m > n); tr.classList.toggle('shown', showAll); });
}

/* ---------- transport ---------- */
function frame() { render(cur, tt); if (tt === 0) narrate(cur); }
function goTo(n) { cur = Math.max(1, Math.min(spec.cycles, n)); tt = 0; frame(); }
function speed() { return +$('#a-speed').value || 1; }
function stop() { playing = false; mode = 'hold'; clearTimeout(phaseTimer); cancelAnimationFrame(raf); raf = 0; $('#a-play').textContent = '▶'; }
function stepAnimated(done) {
  if (cur >= spec.cycles) { if (done) done(false); return; }
  const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduced) { goTo(cur + 1); if (done) done(true); return; }
  const start = performance.now(); const dur = DUR / speed();
  const tick = (ts) => { tt = Math.min(1, (ts - start) / dur); render(cur, tt); if (tt < 1) raf = requestAnimationFrame(tick); else { raf = 0; cur++; tt = 0; frame(); if (done) done(true); } };
  raf = requestAnimationFrame(tick);
}
function play() {
  if (cur >= spec.cycles) goTo(1);
  playing = true; $('#a-play').textContent = '❚❚';
  const loop = () => { if (!playing) return; phaseTimer = setTimeout(() => { if (!playing) return; stepAnimated((ok) => { if (!ok || cur >= spec.cycles) { stop(); return; } loop(); }); }, HOLD / speed()); };
  loop();
}
$('#a-play').addEventListener('click', () => { if (playing) stop(); else play(); });
$('#a-next').addEventListener('click', () => { if (playing || raf) return; stepAnimated(); });
$('#a-prev').addEventListener('click', () => { stop(); goTo(cur - 1); });
$('#a-first').addEventListener('click', () => { stop(); goTo(1); });
$('#a-last').addEventListener('click', () => { stop(); goTo(spec.cycles); });
$('#a-scrub').addEventListener('input', () => { stop(); const v = +$('#a-scrub').value; cur = Math.max(1, Math.min(spec.cycles, Math.floor(v))); tt = cur >= spec.cycles ? 0 : Math.min(0.999, v - cur); render(cur, tt); narrate(cur); });
$('#a-opt-core').addEventListener('change', () => { if (sim) frame(); });
$('#a-showall').addEventListener('change', () => { if (sim) highlightRow(cur); });
document.addEventListener('keydown', (e) => {
  if (!sim || $('#animview').classList.contains('hidden')) return;
  if (e.target.matches('input, textarea, select')) return;
  if (e.key === ' ') { e.preventDefault(); $('#a-play').click(); }
  else if (e.key === 'ArrowRight') { e.preventDefault(); $('#a-next').click(); }
  else if (e.key === 'ArrowLeft') { e.preventDefault(); $('#a-prev').click(); }
  else if (e.key === 'Home') { e.preventDefault(); $('#a-first').click(); }
  else if (e.key === 'End') { e.preventDefault(); $('#a-last').click(); }
});

/* ---------- API used by the trainer: show the animation of a spec, hide it ---------- */
let builtText = null;
function show(text) {
  if (text !== builtText) {
    if (!build(text)) { builtText = null; sim = null; $('#a-schematic').innerHTML = ''; $('#a-narr').innerHTML = ''; $('#a-trace').innerHTML = ''; $('#a-phase').textContent = ''; return false; }
    builtText = text;
  } else if (sim) frame();
  return true;
}
function hide() { stop(); }
window.LIDAnim = { show, hide };
})();
