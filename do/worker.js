// Cludraw Durable Object host. Defines the Canvas DO; the Pages project binds to it
// (script_name "cludraw-do") and routes /ws here. RGB grid + brush dabs + vote-to-wipe.

const W = 160, H = 160;
const N = W * H * 3;
const BRUSHES = [1, 3, 5, 9];
const SWATCHES = ['#ffffff', '#c1c1c1', '#888888', '#4a4a4a', '#000000', '#ffb3ba', '#ff4d4d', '#e50000', '#a00000', '#ff9640', '#e59500', '#a06a42', '#ffe04d', '#e5d900', '#bfef45', '#6acd00', '#02be01', '#00b37a', '#00d3dd', '#0083c7', '#0040ff', '#1d4ed8', '#7d4dff', '#b14dff', '#ff66d8', '#cf00b4', '#820080', '#3d2817'];
const RL_CAP = 1200, RL_RATE = 300; // token bucket in pixels/sec

const todayUTC = () => new Date().toISOString().slice(0, 10);
const nextMidnightUTC = () => { const d = new Date(); d.setUTCHours(24, 0, 0, 0); return d.getTime(); };
function fillBrush(grid, cx, cy, s, r, g, b) {
  const half = (s - 1) >> 1;
  for (let dy = -half; dy <= half; dy++) for (let dx = -half; dx <= half; dx++) {
    const x = cx + dx, y = cy + dy; if (x < 0 || x >= W || y < 0 || y >= H) continue;
    const o = (y * W + x) * 3; grid[o] = r; grid[o + 1] = g; grid[o + 2] = b;
  }
}

export class Canvas {
  constructor(state) {
    this.state = state;
    this.state.blockConcurrencyWhile(async () => {
      const g = await state.storage.get('grid');
      this.grid = (g && g.byteLength === N) ? new Uint8Array(g) : new Uint8Array(N).fill(255);
      this.day = (await state.storage.get('day')) || todayUTC();
      if (this.day !== todayUTC()) await this.reset(false);
      if ((await state.storage.getAlarm()) === null) await state.storage.setAlarm(nextMidnightUTC());
    });
  }

  async fetch(req) {
    if (req.headers.get('Upgrade') !== 'websocket') return new Response('expected websocket', { status: 426 });
    const { 0: client, 1: server } = new WebSocketPair();
    this.state.acceptWebSocket(server);
    server.send(JSON.stringify({ t: 'init', w: W, h: H, swatches: SWATCHES, brushes: BRUSHES }));
    server.send(this.grid.buffer.slice(0));
    this.announce();
    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(ws, raw) {
    let d; try { d = JSON.parse(raw); } catch { return; }
    if (d.t === 'p') {
      const x = d.x | 0, y = d.y | 0, r = d.r & 255, g = d.g & 255, b = d.b & 255;
      let s = d.s | 0; if (!BRUSHES.includes(s)) s = 1;
      if (x < 0 || x >= W || y < 0 || y >= H) return;
      const now = Date.now();
      const att = ws.deserializeAttachment() || { ts: now, tok: RL_CAP, voted: false };
      att.tok = Math.min(RL_CAP, att.tok + (now - att.ts) / 1000 * RL_RATE); att.ts = now;
      const cost = s * s;
      if (att.tok < cost) { ws.serializeAttachment(att); return; }
      att.tok -= cost; ws.serializeAttachment(att);
      fillBrush(this.grid, x, y, s, r, g, b);
      this.schedulePersist();
      this.broadcast({ t: 'p', x, y, r, g, b, s });
    } else if (d.t === 'vote') {
      const att = ws.deserializeAttachment() || { ts: Date.now(), tok: RL_CAP, voted: false };
      att.voted = !att.voted; ws.serializeAttachment(att);
      this.tallyVotes();
    }
  }

  webSocketClose(ws) { try { ws.close(); } catch {} this.announce(); }
  webSocketError() { this.announce(); }

  broadcast(obj) { const m = JSON.stringify(obj); for (const s of this.state.getWebSockets()) { try { s.send(m); } catch {} } }

  voteState() {
    const all = this.state.getWebSockets();
    let votes = 0; for (const s of all) { const a = s.deserializeAttachment(); if (a && a.voted) votes++; }
    return { votes, online: all.length, need: Math.max(2, Math.ceil(all.length * 0.6)) };
  }
  announce() { const v = this.voteState(); this.broadcast({ t: 'n', online: v.online, votes: v.votes, need: v.need }); }
  tallyVotes() {
    const v = this.voteState();
    if (v.votes >= v.need) { this.clearVotes(); this.reset(true); this.broadcast({ t: 'n', online: v.online, votes: 0, need: v.need }); }
    else this.broadcast({ t: 'n', online: v.online, votes: v.votes, need: v.need });
  }
  clearVotes() { for (const s of this.state.getWebSockets()) { const a = s.deserializeAttachment(); if (a && a.voted) { a.voted = false; s.serializeAttachment(a); } } }

  schedulePersist() { if (this._pt) return; this._pt = setTimeout(() => { this._pt = null; this.state.storage.put('grid', this.grid); }, 800); }

  async reset(broadcast = true) {
    this.grid = new Uint8Array(N).fill(255); this.day = todayUTC();
    await this.state.storage.put('grid', this.grid);
    await this.state.storage.put('day', this.day);
    if (broadcast) this.broadcast({ t: 'reset' });
  }
  async alarm() { await this.reset(true); await this.state.storage.setAlarm(nextMidnightUTC()); }
}

export default { async fetch() { return new Response('cludraw DO host', { status: 404 }); } };
