'use strict';
let W = 160, H = 160, grid = null, img = null, brushes = [1, 3, 5, 9], size = 3, cur = [229, 0, 0], voted = false, dirty = false, drawing = false, last = null, ws = null;
const view = document.getElementById('c'), vctx = view.getContext('2d');
const $ = id => document.getElementById(id);
const hexToRgb = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

function fillBrush(cx, cy, s, r, g, b) {
  const half = (s - 1) >> 1;
  for (let dy = -half; dy <= half; dy++) for (let dx = -half; dx <= half; dx++) {
    const x = cx + dx, y = cy + dy; if (x < 0 || x >= W || y < 0 || y >= H) continue;
    const o = (y * W + x) * 3, p = (y * W + x) * 4;
    if (grid) { grid[o] = r; grid[o + 1] = g; grid[o + 2] = b; }
    if (img) { img.data[p] = r; img.data[p + 1] = g; img.data[p + 2] = b; img.data[p + 3] = 255; }
  }
  dirty = true;
}
function rebuild() { if (!img || !grid) return; for (let i = 0; i < W * H; i++) { const o = i * 3, p = i * 4; img.data[p] = grid[o]; img.data[p + 1] = grid[o + 1]; img.data[p + 2] = grid[o + 2]; img.data[p + 3] = 255; } dirty = true; }
function flush() { if (dirty && img) { vctx.putImageData(img, 0, 0); dirty = false; } requestAnimationFrame(flush); }
requestAnimationFrame(flush);

function setColor(rgb, el) { cur = rgb; document.querySelectorAll('.sw').forEach(s => s.classList.remove('on')); $('eraser').classList.remove('on'); if (el) el.classList.add('on'); }

function buildUI(swatches) {
  const sc = $('swatches'); sc.innerHTML = '';
  swatches.forEach(hex => { const b = document.createElement('button'); b.className = 'sw'; b.style.background = hex; b.title = hex; b.onclick = () => setColor(hexToRgb(hex), b); sc.appendChild(b); });
  const bz = $('brushes'); bz.innerHTML = '';
  brushes.forEach(s => { const b = document.createElement('button'); b.className = 'bz' + (s === size ? ' on' : ''); const d = Math.min(22, s * 2 + 2); b.innerHTML = `<span class="ball" style="width:${d}px;height:${d}px"></span>`; b.title = s + 'px'; b.onclick = () => { size = s; document.querySelectorAll('.bz').forEach(x => x.classList.remove('on')); b.classList.add('on'); }; bz.appendChild(b); });
}

function cell(e) { const r = view.getBoundingClientRect(); return [Math.floor((e.clientX - r.left) / r.width * W), Math.floor((e.clientY - r.top) / r.height * H)]; }
function dab(x, y) { if (!grid) return; fillBrush(x, y, size, cur[0], cur[1], cur[2]); if (ws && ws.readyState === 1) ws.send(JSON.stringify({ t: 'p', x, y, r: cur[0], g: cur[1], b: cur[2], s: size })); }
function line(x0, y0, x1, y1) { const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1; let err = dx - dy, x = x0, y = y0; for (; ;) { dab(x, y); if (x === x1 && y === y1) break; const e2 = 2 * err; if (e2 > -dy) { err -= dy; x += sx; } if (e2 < dx) { err += dx; y += sy; } } }

view.addEventListener('pointerdown', e => { if (!grid) return; drawing = true; try { view.setPointerCapture(e.pointerId); } catch {} const [x, y] = cell(e); dab(x, y); last = [x, y]; });
view.addEventListener('pointermove', e => { if (!drawing || !grid) return; const [x, y] = cell(e); if (last) line(last[0], last[1], x, y); else dab(x, y); last = [x, y]; });
addEventListener('pointerup', () => { drawing = false; last = null; });

$('picker').addEventListener('input', e => setColor(hexToRgb(e.target.value), null));
$('eraser').addEventListener('click', () => { cur = [255, 255, 255]; document.querySelectorAll('.sw').forEach(s => s.classList.remove('on')); $('eraser').classList.add('on'); });
$('vote').addEventListener('click', () => { if (ws && ws.readyState === 1) { ws.send(JSON.stringify({ t: 'vote' })); voted = !voted; $('vote').classList.toggle('voted', voted); } });

function connect() {
  ws = new WebSocket((location.protocol === 'https:' ? 'wss' : 'ws') + '://' + location.host + '/ws');
  ws.binaryType = 'arraybuffer';
  ws.onopen = () => { $('status').textContent = 'live'; $('status').className = 'on'; };
  ws.onclose = () => { $('status').textContent = 'reconnecting…'; $('status').className = 'off'; setTimeout(connect, 1500); };
  ws.onmessage = ev => {
    if (ev.data instanceof ArrayBuffer) { grid = new Uint8Array(ev.data); rebuild(); return; }
    const d = JSON.parse(ev.data);
    if (d.t === 'init') { W = d.w; H = d.h; brushes = d.brushes; if (!brushes.includes(size)) size = brushes[1] || brushes[0]; view.width = W; view.height = H; img = vctx.createImageData(W, H); buildUI(d.swatches); rebuild(); }
    else if (d.t === 'p') fillBrush(d.x, d.y, d.s, d.r, d.g, d.b);
    else if (d.t === 'n') { $('online').textContent = d.online; $('votecount').textContent = d.votes + '/' + d.need; }
    else if (d.t === 'reset') { grid = new Uint8Array(W * H * 3).fill(255); rebuild(); voted = false; $('vote').classList.remove('voted'); }
  };
}
connect();
