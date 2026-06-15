// Cludraw - a shared pixel canvas. One Durable Object holds the grid, broadcasts
// edits over WebSockets, persists to its own storage, and resets daily via an alarm.

const W = 128, H = 128;
const PALETTE = ['#ffffff', '#e4e4e4', '#888888', '#222222', '#ffa7d1', '#e50000', '#e59500', '#a06a42', '#e5d900', '#94e044', '#02be01', '#00d3dd', '#0083c7', '#0000ea', '#cf6ee4', '#820080'];
const RL_CAP = 80, RL_RATE = 50; // token bucket: ~50 pixels/sec sustained, bursts to 80

const todayUTC = () => new Date().toISOString().slice(0, 10);
const nextMidnightUTC = () => { const d = new Date(); d.setUTCHours(24, 0, 0, 0); return d.getTime(); };

export class Canvas {
  constructor(state, env) {
    this.state = state; this.env = env;
    this.state.blockConcurrencyWhile(async () => {
      const g = await state.storage.get('grid');
      this.grid = g ? new Uint8Array(g) : new Uint8Array(W * H);
      this.day = (await state.storage.get('day')) || todayUTC();
      if (this.day !== todayUTC()) await this.reset(false);
      if ((await state.storage.getAlarm()) === null) await state.storage.setAlarm(nextMidnightUTC());
    });
  }

  async fetch(req) {
    if (req.headers.get('Upgrade') !== 'websocket') return new Response('expected websocket', { status: 426 });
    const { 0: client, 1: server } = new WebSocketPair();
    this.state.acceptWebSocket(server);
    server.send(JSON.stringify({ t: 'init', w: W, h: H, palette: PALETTE }));
    server.send(this.grid.buffer.slice(0));
    this.broadcastCount();
    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(ws, msg) {
    let d; try { d = JSON.parse(msg); } catch { return; }
    if (d.t !== 'p') return;
    const now = Date.now();
    const att = ws.deserializeAttachment() || { ts: now, tok: RL_CAP };
    att.tok = Math.min(RL_CAP, att.tok + (now - att.ts) / 1000 * RL_RATE); att.ts = now;
    if (att.tok < 1) { ws.serializeAttachment(att); return; }
    att.tok -= 1; ws.serializeAttachment(att);
    const x = d.x | 0, y = d.y | 0, c = d.c | 0;
    if (x < 0 || x >= W || y < 0 || y >= H || c < 0 || c >= PALETTE.length) return;
    this.grid[y * W + x] = c;
    this.schedulePersist();
    const out = JSON.stringify({ t: 'p', x, y, c });
    for (const s of this.state.getWebSockets()) { try { s.send(out); } catch {} }
  }

  webSocketClose(ws) { try { ws.close(); } catch {} this.broadcastCount(); }
  webSocketError() { this.broadcastCount(); }

  broadcastCount() {
    const m = JSON.stringify({ t: 'n', online: this.state.getWebSockets().length });
    for (const s of this.state.getWebSockets()) { try { s.send(m); } catch {} }
  }

  schedulePersist() {
    if (this._pt) return;
    this._pt = setTimeout(() => { this._pt = null; this.state.storage.put('grid', this.grid); }, 800);
  }

  async reset(broadcast = true) {
    this.grid = new Uint8Array(W * H); this.day = todayUTC();
    await this.state.storage.put('grid', this.grid);
    await this.state.storage.put('day', this.day);
    if (broadcast) { const m = JSON.stringify({ t: 'reset' }); for (const s of this.state.getWebSockets()) { try { s.send(m); } catch {} } }
  }

  async alarm() { await this.reset(true); await this.state.storage.setAlarm(nextMidnightUTC()); }
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname === '/ws') {
      const id = env.CANVAS.idFromName('global');
      return env.CANVAS.get(id).fetch(req);
    }
    return env.ASSETS.fetch(req);
  }
};
