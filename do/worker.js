// Cludraw Durable Object host. Vector strokes (resolution-independent), broadcast over
// WebSockets, persisted in SQLite, daily reset + vote-to-wipe.

const SWATCHES = ['#ffffff', '#c1c1c1', '#888888', '#4a4a4a', '#000000', '#ffb3ba', '#ff4d4d', '#e50000', '#a00000', '#ff9640', '#e59500', '#a06a42', '#ffe04d', '#e5d900', '#bfef45', '#6acd00', '#02be01', '#00b37a', '#00d3dd', '#0083c7', '#0040ff', '#1d4ed8', '#7d4dff', '#b14dff', '#ff66d8', '#cf00b4', '#820080', '#3d2817'];
const BRUSHES = [3, 7, 14, 28]; // stroke widths, in units of a 1000px reference canvas
const MAX_STROKES = 9000;       // replay buffer cap (drop oldest beyond this)
const RL_CAP = 6000, RL_RATE = 2500; // token bucket in points/sec

const todayUTC = () => new Date().toISOString().slice(0, 10);
const nextMidnightUTC = () => { const d = new Date(); d.setUTCHours(24, 0, 0, 0); return d.getTime(); };
const sanitizeColor = c => (typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c)) ? c.toLowerCase() : '#000000';
const clampW = w => { w = +w; return (w >= 1 && w <= 60) ? w : 7; };

export class Canvas {
  constructor(state) {
    this.state = state; this.sql = state.storage.sql;
    this.strokes = []; this.active = new Map();
    this.state.blockConcurrencyWhile(async () => {
      this.sql.exec('CREATE TABLE IF NOT EXISTS blob(seq INTEGER PRIMARY KEY AUTOINCREMENT, part TEXT)');
      let json = ''; for (const r of this.sql.exec('SELECT part FROM blob ORDER BY seq')) json += r.part;
      if (json) { try { this.strokes = JSON.parse(json) || []; } catch { this.strokes = []; } }
      this.day = (await state.storage.get('day')) || todayUTC();
      if (this.day !== todayUTC()) await this.reset(false);
      if ((await state.storage.getAlarm()) === null) await state.storage.setAlarm(nextMidnightUTC());
    });
  }

  async fetch(req) {
    if (req.headers.get('Upgrade') !== 'websocket') return new Response('expected websocket', { status: 426 });
    const { 0: client, 1: server } = new WebSocketPair();
    this.state.acceptWebSocket(server);
    server.send(JSON.stringify({ t: 'init', swatches: SWATCHES, brushes: BRUSHES }));
    for (let i = 0; i < this.strokes.length; i += 350) server.send(JSON.stringify({ t: 'load', strokes: this.strokes.slice(i, i + 350) }));
    server.send(JSON.stringify({ t: 'loaded' }));
    this.announce();
    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(ws, raw) {
    let d; try { d = JSON.parse(raw); } catch { return; }
    if (d.t === 's') {
      if (!Array.isArray(d.p) || d.p.length < 2) return;
      const np = d.p.length / 2;
      const now = Date.now();
      const att = ws.deserializeAttachment() || { ts: now, tok: RL_CAP, voted: false };
      att.tok = Math.min(RL_CAP, att.tok + (now - att.ts) / 1000 * RL_RATE); att.ts = now;
      if (att.tok < np) { ws.serializeAttachment(att); return; }
      att.tok -= np; ws.serializeAttachment(att);
      let st = this.active.get(d.id);
      if (!st) {
        st = { c: sanitizeColor(d.c), w: clampW(d.w), p: [] };
        this.active.set(d.id, st); this.strokes.push(st);
        if (this.strokes.length > MAX_STROKES) this.strokes.shift();
        if (this.active.size > 3000) this.active.clear();
      }
      for (let i = 0; i < d.p.length; i++) { const v = +d.p[i]; st.p.push(v < 0 ? 0 : v > 1 ? 1 : v || 0); }
      this.schedulePersist();
      const out = JSON.stringify({ t: 's', id: d.id, c: st.c, w: st.w, p: d.p });
      for (const s of this.state.getWebSockets()) if (s !== ws) { try { s.send(out); } catch {} }
    } else if (d.t === 'e') {
      this.active.delete(d.id);
    } else if (d.t === 'vote') {
      const att = ws.deserializeAttachment() || { ts: Date.now(), tok: RL_CAP, voted: false };
      att.voted = !att.voted; ws.serializeAttachment(att);
      this.tally();
    }
  }

  webSocketClose(ws) { try { ws.close(); } catch {} this.announce(); }
  webSocketError() { this.announce(); }

  broadcast(o) { const m = JSON.stringify(o); for (const s of this.state.getWebSockets()) { try { s.send(m); } catch {} } }
  voteState() { const all = this.state.getWebSockets(); let v = 0; for (const s of all) { const a = s.deserializeAttachment(); if (a && a.voted) v++; } return { votes: v, online: all.length, need: Math.max(2, Math.ceil(all.length * 0.6)) }; }
  announce() { const v = this.voteState(); this.broadcast({ t: 'n', online: v.online, votes: v.votes, need: v.need }); }
  tally() { const v = this.voteState(); if (v.votes >= v.need) { this.clearVotes(); this.reset(true); this.broadcast({ t: 'n', online: v.online, votes: 0, need: v.need }); } else this.broadcast({ t: 'n', online: v.online, votes: v.votes, need: v.need }); }
  clearVotes() { for (const s of this.state.getWebSockets()) { const a = s.deserializeAttachment(); if (a && a.voted) { a.voted = false; s.serializeAttachment(a); } } }

  schedulePersist() { if (this._pt) return; this._pt = setTimeout(() => { this._pt = null; this.persist(); }, 1500); }
  persist() {
    const json = JSON.stringify(this.strokes);
    this.sql.exec('DELETE FROM blob');
    for (let i = 0; i < json.length; i += 100000) this.sql.exec('INSERT INTO blob(part) VALUES (?)', json.slice(i, i + 100000));
  }

  async reset(broadcast = true) {
    this.strokes = []; this.active.clear(); this.sql.exec('DELETE FROM blob');
    this.day = todayUTC(); await this.state.storage.put('day', this.day);
    if (broadcast) this.broadcast({ t: 'reset' });
  }
  async alarm() { await this.reset(true); await this.state.storage.setAlarm(nextMidnightUTC()); }
}

export default { async fetch() { return new Response('cludraw DO host', { status: 404 }); } };
