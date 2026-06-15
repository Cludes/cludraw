'use strict';
let W = 128, H = 128, PALETTE = [], PRGB = [], grid = null, sel = 5, drawing = false, lastCell = null, dirty = false, img = null, ws = null;
const view = document.getElementById('c');
const vctx = view.getContext('2d');
const hexToRgb = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const $ = id => document.getElementById(id);

function setupGrid() { view.width = W; view.height = H; img = vctx.createImageData(W, H); }
function rebuild() { if (!img || !grid) return; for (let i = 0; i < W * H; i++) { const c = PRGB[grid[i]] || [255, 255, 255], o = i * 4; img.data[o] = c[0]; img.data[o + 1] = c[1]; img.data[o + 2] = c[2]; img.data[o + 3] = 255; } dirty = true; }
function setPixel(x, y, c) { if (x < 0 || x >= W || y < 0 || y >= H || !img) return; grid[y * W + x] = c; const o = (y * W + x) * 4, col = PRGB[c] || [255, 255, 255]; img.data[o] = col[0]; img.data[o + 1] = col[1]; img.data[o + 2] = col[2]; img.data[o + 3] = 255; dirty = true; }
function flush() { if (dirty) { vctx.putImageData(img, 0, 0); dirty = false; } requestAnimationFrame(flush); }
requestAnimationFrame(flush);

function buildPalette() {
  const p = $('palette'); p.innerHTML = '';
  PALETTE.forEach((hex, i) => { const b = document.createElement('button'); b.className = 'sw' + (i === sel ? ' on' : ''); b.style.background = hex; b.title = hex; b.onclick = () => { sel = i; document.querySelectorAll('.sw').forEach((s, j) => s.classList.toggle('on', j === sel)); }; p.appendChild(b); });
}

function cell(e) { const r = view.getBoundingClientRect(); return [Math.floor((e.clientX - r.left) / r.width * W), Math.floor((e.clientY - r.top) / r.height * H)]; }
function paintCell(x, y) { if (x < 0 || x >= W || y < 0 || y >= H || !grid) return; if (grid[y * W + x] === sel) return; setPixel(x, y, sel); if (ws && ws.readyState === 1) ws.send(JSON.stringify({ t: 'p', x, y, c: sel })); }
function paintLine(x0, y0, x1, y1) { const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1; let err = dx - dy, x = x0, y = y0; for (; ;) { paintCell(x, y); if (x === x1 && y === y1) break; const e2 = 2 * err; if (e2 > -dy) { err -= dy; x += sx; } if (e2 < dx) { err += dx; y += sy; } } }

view.addEventListener('pointerdown', e => { if (!grid) return; drawing = true; try { view.setPointerCapture(e.pointerId); } catch (err) {} const [x, y] = cell(e); paintCell(x, y); lastCell = [x, y]; });
view.addEventListener('pointermove', e => { if (!drawing || !grid) return; const [x, y] = cell(e); if (lastCell) paintLine(lastCell[0], lastCell[1], x, y); else paintCell(x, y); lastCell = [x, y]; });
addEventListener('pointerup', () => { drawing = false; lastCell = null; });

function connect() {
  ws = new WebSocket((location.protocol === 'https:' ? 'wss' : 'ws') + '://' + location.host + '/ws');
  ws.binaryType = 'arraybuffer';
  ws.onopen = () => { $('status').textContent = 'live'; $('status').className = 'on'; };
  ws.onclose = () => { $('status').textContent = 'reconnecting…'; $('status').className = 'off'; setTimeout(connect, 1500); };
  ws.onmessage = ev => {
    if (ev.data instanceof ArrayBuffer) { grid = new Uint8Array(ev.data); rebuild(); return; }
    const d = JSON.parse(ev.data);
    if (d.t === 'init') { W = d.w; H = d.h; PALETTE = d.palette; PRGB = PALETTE.map(hexToRgb); if (sel >= PALETTE.length) sel = 5; setupGrid(); buildPalette(); rebuild(); }
    else if (d.t === 'p') setPixel(d.x, d.y, d.c);
    else if (d.t === 'n') $('online').textContent = d.online;
    else if (d.t === 'reset') { grid = new Uint8Array(W * H); rebuild(); }
  };
}
connect();
