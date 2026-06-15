'use strict';
const CW = 1200, CH = 1200, SCALE = CW / 1000;
let brushes = [3, 7, 14, 28], curW = 7, curHex = '#e50000', voted = false, drawing = false, curId = null, cur = null, buf = [], localN = 0;
const active = new Map();
const view = document.getElementById('c'), ctx = view.getContext('2d');
const $ = id => document.getElementById(id);
view.width = CW; view.height = CH;
function clear() { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, CW, CH); }
clear();

function style(c, w) { ctx.strokeStyle = c; ctx.fillStyle = c; ctx.lineWidth = w * SCALE; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; }
function seg(st, p) {
  style(st.c, st.w); let i = 0;
  if (!st.has) { const x = p[0] * CW, y = p[1] * CH; ctx.beginPath(); ctx.arc(x, y, st.w * SCALE / 2, 0, 7); ctx.fill(); st.lx = p[0]; st.ly = p[1]; st.has = true; i = 2; }
  ctx.beginPath(); ctx.moveTo(st.lx * CW, st.ly * CH);
  for (; i < p.length; i += 2) { ctx.lineTo(p[i] * CW, p[i + 1] * CH); st.lx = p[i]; st.ly = p[i + 1]; }
  ctx.stroke();
}
function full(c, w, p) {
  if (p.length < 2) return; style(c, w);
  if (p.length === 2) { ctx.beginPath(); ctx.arc(p[0] * CW, p[1] * CH, w * SCALE / 2, 0, 7); ctx.fill(); return; }
  ctx.beginPath(); ctx.moveTo(p[0] * CW, p[1] * CH);
  for (let i = 2; i < p.length; i += 2) ctx.lineTo(p[i] * CW, p[i + 1] * CH);
  ctx.stroke();
}

function setColor(hex, el) { curHex = hex; document.querySelectorAll('.sw').forEach(s => s.classList.remove('on')); $('eraser').classList.remove('on'); if (el) el.classList.add('on'); }
function buildUI(swatches) {
  const sc = $('swatches'); sc.innerHTML = '';
  swatches.forEach(hex => { const b = document.createElement('button'); b.className = 'sw'; b.style.background = hex; b.title = hex; b.onclick = () => setColor(hex, b); sc.appendChild(b); });
  const bz = $('brushes'); bz.innerHTML = '';
  brushes.forEach(w => { const b = document.createElement('button'); b.className = 'bz' + (w === curW ? ' on' : ''); const d = Math.min(24, 4 + w * 0.7); b.innerHTML = `<span class="ball" style="width:${d}px;height:${d}px"></span>`; b.title = w; b.onclick = () => { curW = w; document.querySelectorAll('.bz').forEach(x => x.classList.remove('on')); b.classList.add('on'); }; bz.appendChild(b); });
}

function pt(e) { const r = view.getBoundingClientRect(); let x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height; x = x < 0 ? 0 : x > 1 ? 1 : x; y = y < 0 ? 0 : y > 1 ? 1 : y; return [Math.round(x * 1e4) / 1e4, Math.round(y * 1e4) / 1e4]; }
function flush(end) { if (buf.length >= 2 && ws && ws.readyState === 1) ws.send(JSON.stringify({ t: 's', id: curId, c: cur.c, w: cur.w, p: buf })); buf = []; if (end && ws && ws.readyState === 1) ws.send(JSON.stringify({ t: 'e', id: curId })); }
view.addEventListener('pointerdown', e => { drawing = true; try { view.setPointerCapture(e.pointerId); } catch {} curId = 'L' + (localN++); cur = { c: curHex, w: curW, has: false }; active.set(curId, cur); const [x, y] = pt(e); seg(cur, [x, y]); buf = [x, y]; });
view.addEventListener('pointermove', e => { if (!drawing) return; const [x, y] = pt(e); seg(cur, [x, y]); buf.push(x, y); });
addEventListener('pointerup', () => { if (!drawing) return; drawing = false; flush(true); });
function tick() { if (drawing && buf.length >= 2) flush(false); requestAnimationFrame(tick); }
requestAnimationFrame(tick);

$('picker').addEventListener('input', e => setColor(e.target.value, null));
$('eraser').addEventListener('click', () => { curHex = '#ffffff'; document.querySelectorAll('.sw').forEach(s => s.classList.remove('on')); $('eraser').classList.add('on'); });
$('vote').addEventListener('click', () => { if (ws && ws.readyState === 1) { ws.send(JSON.stringify({ t: 'vote' })); voted = !voted; $('vote').classList.toggle('voted', voted); } });

let ws = null;
function connect() {
  ws = new WebSocket((location.protocol === 'https:' ? 'wss' : 'ws') + '://' + location.host + '/ws');
  ws.onopen = () => { $('status').textContent = 'live'; $('status').className = 'on'; };
  ws.onclose = () => { $('status').textContent = 'reconnecting…'; $('status').className = 'off'; setTimeout(connect, 1500); };
  ws.onmessage = ev => {
    const d = JSON.parse(ev.data);
    if (d.t === 'init') { brushes = d.brushes; if (!brushes.includes(curW)) curW = brushes[1] || brushes[0]; buildUI(d.swatches); }
    else if (d.t === 'load') { for (const s of d.strokes) full(s.c, s.w, s.p); }
    else if (d.t === 's') { let st = active.get(d.id); if (!st) { st = { c: d.c, w: d.w, has: false }; active.set(d.id, st); } seg(st, d.p); }
    else if (d.t === 'n') { $('online').textContent = d.online; $('votecount').textContent = d.votes + '/' + d.need; }
    else if (d.t === 'reset') { clear(); active.clear(); voted = false; $('vote').classList.remove('voted'); }
  };
}
connect();
