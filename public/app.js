'use strict';
const CW = 1200, CH = 1200, SCALE = CW / 1000;
let brushes = [3, 7, 14, 28], curW = 7, curHex = '#e50000', voted = false, drawing = false, curId = null, cur = null, buf = [], localN = 0;
const active = new Map();
const view = document.getElementById('c'), ctx = view.getContext('2d');
const $ = id => document.getElementById(id);
view.width = CW; view.height = CH;
function clear() { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, CW, CH); }
clear();

function updateCursor() {
  const d = Math.max(6, Math.round(curW * view.clientWidth / 1000)); // brush diameter in display px
  const sz = d + 4, c = sz / 2, r = d / 2;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${sz}" height="${sz}"><circle cx="${c}" cy="${c}" r="${r}" fill="rgba(0,0,0,.05)" stroke="#fff" stroke-width="2.5"/><circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="#000" stroke-width="1"/></svg>`;
  view.style.cursor = `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${c} ${c}, crosshair`;
}
addEventListener('resize', updateCursor);
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
  brushes.forEach(w => { const b = document.createElement('button'); b.className = 'bz' + (w === curW ? ' on' : ''); const d = Math.min(24, 4 + w * 0.7); b.innerHTML = `<span class="ball" style="width:${d}px;height:${d}px"></span>`; b.title = w; b.onclick = () => { curW = w; document.querySelectorAll('.bz').forEach(x => x.classList.remove('on')); b.classList.add('on'); updateCursor(); }; bz.appendChild(b); });
  updateCursor();
}

function pt(e) { const r = view.getBoundingClientRect(); let x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height; x = x < 0 ? 0 : x > 1 ? 1 : x; y = y < 0 ? 0 : y > 1 ? 1 : y; return [Math.round(x * 1e4) / 1e4, Math.round(y * 1e4) / 1e4]; }
function flush(end) { if (buf.length >= 2 && ws && ws.readyState === 1) ws.send(JSON.stringify({ t: 's', id: curId, c: cur.c, w: cur.w, p: buf })); buf = []; if (end && ws && ws.readyState === 1) ws.send(JSON.stringify({ t: 'e', id: curId })); }
view.addEventListener('pointerdown', e => { drawing = true; try { view.setPointerCapture(e.pointerId); } catch {} curId = 'L' + (localN++); cur = { c: curHex, w: curW, has: false }; active.set(curId, cur); const [x, y] = pt(e); sendCur(x, y); seg(cur, [x, y]); buf = [x, y]; });
view.addEventListener('pointermove', e => { const [x, y] = pt(e); sendCur(x, y); if (!drawing) return; seg(cur, [x, y]); buf.push(x, y); });
addEventListener('pointerup', () => { if (!drawing) return; drawing = false; flush(true); });
function tick() { if (drawing && buf.length >= 2) flush(false); requestAnimationFrame(tick); }
requestAnimationFrame(tick);

// ── remote cursors (you see others', never your own) ──
let curT = 0;
function sendCur(x, y) { const now = performance.now(); if (now - curT < 45) return; curT = now; if (ws && ws.readyState === 1) ws.send(JSON.stringify({ t: 'cur', x, y, col: curHex })); }
const cursors = new Map();
const lum = h => (0.299 * parseInt(h.slice(1, 3), 16) + 0.587 * parseInt(h.slice(3, 5), 16) + 0.114 * parseInt(h.slice(5, 7), 16)) / 255;
const contrast = c => (/^#[0-9a-f]{6}$/i.test(c) && lum(c) > 0.62) ? '#111' : '#fff';
function cursorEl(name, col) {
  const el = document.createElement('div'); el.className = 'rcur'; const txt = contrast(col);
  el.innerHTML = `<svg width="18" height="18" viewBox="0 0 18 18"><path d="M2 2 L2 15 L6 11 L9 17 L11.5 16 L8.5 10 L14 10 Z" fill="${col}" stroke="${txt}" stroke-width="1"/></svg><span class="lab" style="background:${col};color:${txt}">${esc(name)}</span>`;
  return el;
}
function recolor(c, col) { c.col = col; const p = c.el.querySelector('path'), l = c.el.querySelector('.lab'), txt = contrast(col); p.setAttribute('fill', col); p.setAttribute('stroke', txt); l.style.background = col; l.style.color = txt; }
setInterval(() => { const now = performance.now(); for (const [id, c] of cursors) if (now - c.seen > 6000) { c.el.remove(); cursors.delete(id); } }, 2000);

$('picker').addEventListener('input', e => setColor(e.target.value, null));
$('eraser').addEventListener('click', () => { curHex = '#ffffff'; document.querySelectorAll('.sw').forEach(s => s.classList.remove('on')); $('eraser').classList.add('on'); });
$('vote').addEventListener('click', () => { if (ws && ws.readyState === 1) { ws.send(JSON.stringify({ t: 'vote' })); voted = !voted; $('vote').classList.toggle('voted', voted); } });

// ── identity / presence / safety ──
const BAD = ['fuck', 'shit', 'cunt', 'bitch', 'bastard', 'dick', 'cock', 'pussy', 'whore', 'slut', 'nigger', 'nigga', 'faggot', 'fag', 'retard', 'rape', 'nazi', 'hitler', 'kike', 'spic', 'chink', 'wetback', 'tranny', 'pedo', 'cum', 'penis', 'vagina', 'porn', 'sex', 'anus', 'asshole'];
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function nameOk(n) { n = n.trim(); if (n.length < 1 || n.length > 16 || !/^[\w \-]+$/.test(n)) return false; const low = n.toLowerCase().replace(/[\s_\-]/g, ''); for (const w of BAD) if (low.includes(w)) return false; return true; }
function renderPresence(users) { $('sbcount').textContent = users.length; $('sblist').innerHTML = users.map(u => `<li><span class="uname">${esc(u.n)}</span><span class="uctry">${esc(u.c || '')}</span></li>`).join(''); }

let ws = null, myName = '', banned = false;
function connect() {
  ws = new WebSocket((location.protocol === 'https:' ? 'wss' : 'ws') + '://' + location.host + '/ws?name=' + encodeURIComponent(myName));
  ws.onopen = () => { $('status').textContent = 'live'; $('status').className = 'on'; };
  ws.onclose = () => { if (banned) return; $('status').textContent = 'reconnecting…'; $('status').className = 'off'; setTimeout(connect, 1500); };
  ws.onmessage = ev => {
    const d = JSON.parse(ev.data);
    if (d.t === 'init') { brushes = d.brushes; if (!brushes.includes(curW)) curW = brushes[1] || brushes[0]; buildUI(d.swatches); if (d.you) $('me').textContent = d.you.name; }
    else if (d.t === 'load') { for (const s of d.strokes) full(s.c, s.w, s.p); }
    else if (d.t === 's') { let st = active.get(d.id); if (!st) { st = { c: d.c, w: d.w, has: false }; active.set(d.id, st); } seg(st, d.p); }
    else if (d.t === 'n') { $('online').textContent = d.online; $('votecount').textContent = d.votes + '/' + d.need; }
    else if (d.t === 'presence') renderPresence(d.users);
    else if (d.t === 'cur') { const col = d.col || '#000000'; let c = cursors.get(d.id); if (!c) { c = { el: cursorEl(d.n, col), col }; cursors.set(d.id, c); $('cursors').appendChild(c.el); } else if (col !== c.col) recolor(c, col); c.el.style.left = d.x * 100 + '%'; c.el.style.top = d.y * 100 + '%'; c.seen = performance.now(); }
    else if (d.t === 'curgone') { const c = cursors.get(d.id); if (c) { c.el.remove(); cursors.delete(d.id); } }
    else if (d.t === 'reset') { clear(); active.clear(); voted = false; $('vote').classList.remove('voted'); }
    else if (d.t === 'banned') { banned = true; try { ws.close(); } catch {} $('blocked').classList.remove('hidden'); }
  };
}

$('report').addEventListener('click', () => { if (ws && ws.readyState === 1) { ws.send(JSON.stringify({ t: 'report' })); const r = $('report'), o = r.textContent; r.textContent = 'Reported'; r.disabled = true; setTimeout(() => { r.textContent = o; r.disabled = false; }, 2500); } });

function join() {
  const v = $('nameinput').value.trim();
  if (!nameOk(v)) { $('nameerr').textContent = 'Pick a clean name (1-16 letters, numbers, spaces).'; return; }
  myName = v; try { localStorage.setItem('cludraw-name', v); } catch {}
  $('gate').classList.add('hidden'); connect();
}
$('join').addEventListener('click', join);
$('nameinput').addEventListener('keydown', e => { if (e.key === 'Enter') join(); });
try { const s = localStorage.getItem('cludraw-name'); if (s) $('nameinput').value = s; } catch {}
$('nameinput').focus();
