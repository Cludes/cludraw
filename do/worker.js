// Cludraw Durable Object. Vector strokes over WebSockets, SQLite-persisted. Identity =
// salted-IP hash + username + country. Presence list, reports, bans, admin actions, daily reset.

const SWATCHES = ['#ffffff', '#c1c1c1', '#888888', '#4a4a4a', '#000000', '#ffb3ba', '#ff4d4d', '#e50000', '#a00000', '#ff9640', '#e59500', '#a06a42', '#ffe04d', '#e5d900', '#bfef45', '#6acd00', '#02be01', '#00b37a', '#00d3dd', '#0083c7', '#0040ff', '#1d4ed8', '#7d4dff', '#b14dff', '#ff66d8', '#cf00b4', '#820080', '#3d2817'];
const BRUSHES = [3, 7, 14, 28];
const MAX_STROKES = 9000;
const RL_CAP = 6000, RL_RATE = 2500;
const BAD = ['fuck', 'shit', 'cunt', 'bitch', 'bastard', 'dick', 'cock', 'pussy', 'whore', 'slut', 'nigger', 'nigga', 'faggot', 'fag', 'retard', 'rape', 'nazi', 'hitler', 'kike', 'spic', 'chink', 'wetback', 'tranny', 'pedo', 'cum', 'penis', 'vagina', 'porn', 'sex', 'anus', 'asshole'];

const todayUTC = () => new Date().toISOString().slice(0, 10);
const nextMidnightUTC = () => { const d = new Date(); d.setUTCHours(24, 0, 0, 0); return d.getTime(); };
const sanitizeColor = c => (typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c)) ? c.toLowerCase() : '#000000';
const clampW = w => { w = +w; return (w >= 1 && w <= 60) ? w : 7; };
const json = o => new Response(JSON.stringify(o), { headers: { 'content-type': 'application/json' } });
function cleanName(n) {
  n = (n || '').toString().trim().slice(0, 16).replace(/[^\w \-]/g, '');
  if (!n) return '';
  const low = n.toLowerCase().replace(/[\s_\-]/g, '');
  for (const w of BAD) if (low.includes(w)) return '';
  return n;
}
async function hashIp(salt, ip) {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(salt + '|' + ip));
  return [...new Uint8Array(h)].slice(0, 8).map(b => b.toString(16).padStart(2, '0')).join('');
}

export class Canvas {
  constructor(state, env) {
    this.state = state; this.env = env; this.sql = state.storage.sql;
    this.strokes = []; this.active = new Map();
    this.state.blockConcurrencyWhile(async () => {
      this.sql.exec('CREATE TABLE IF NOT EXISTS blob(seq INTEGER PRIMARY KEY AUTOINCREMENT, part TEXT)');
      let jsonStr = ''; for (const r of this.sql.exec('SELECT part FROM blob ORDER BY seq')) jsonStr += r.part;
      if (jsonStr) { try { this.strokes = JSON.parse(jsonStr) || []; } catch { this.strokes = []; } }
      for (const s of this.strokes) if (!s.id) s.id = 'x' + Math.random().toString(36).slice(2, 8);
      this.salt = await state.storage.get('salt');
      if (!this.salt) { this.salt = [...crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16)).join(''); await state.storage.put('salt', this.salt); }
      this.banned = new Set(await state.storage.get('banned') || []);
      this.reports = await state.storage.get('reports') || [];
      this.day = (await state.storage.get('day')) || todayUTC();
      if (this.day !== todayUTC()) await this.reset(false);
      if ((await state.storage.getAlarm()) === null) await state.storage.setAlarm(nextMidnightUTC());
    });
  }

  async fetch(req) {
    const url = new URL(req.url);
    if (req.headers.get('Upgrade') === 'websocket') {
      const ip = await hashIp(this.salt, req.headers.get('CF-Connecting-IP') || 'unknown');
      const country = req.headers.get('CF-IPCountry') || '??';
      let name = cleanName(url.searchParams.get('name')); if (!name) name = 'anon' + Math.floor(Math.random() * 900 + 100);
      const { 0: client, 1: server } = new WebSocketPair();
      this.state.acceptWebSocket(server);
      server.serializeAttachment({ ip, name, country, tok: RL_CAP, ts: Date.now(), voted: false, cid: Math.random().toString(36).slice(2, 8), col: '#e50000' });
      if (this.banned.has(ip)) { try { server.send(JSON.stringify({ t: 'banned' })); server.close(4003, 'banned'); } catch {} return new Response(null, { status: 101, webSocket: client }); }
      server.send(JSON.stringify({ t: 'init', swatches: SWATCHES, brushes: BRUSHES, you: { name, country } }));
      for (let i = 0; i < this.strokes.length; i += 350) server.send(JSON.stringify({ t: 'load', strokes: this.strokes.slice(i, i + 350).map(s => ({ id: s.id, c: s.c, w: s.w, p: s.p })) }));
      server.send(JSON.stringify({ t: 'loaded' }));
      this.announce(); this.presence();
      return new Response(null, { status: 101, webSocket: client });
    }
    if (req.method === 'POST' && url.pathname.endsWith('/admin')) return this.admin(req);
    return new Response('cludraw DO', { status: 404 });
  }

  webSocketMessage(ws, raw) {
    let d; try { d = JSON.parse(raw); } catch { return; }
    const att = ws.deserializeAttachment() || {};
    if (this.banned.has(att.ip)) return;
    if (d.t === 's') {
      if (!Array.isArray(d.p) || d.p.length < 2) return;
      const np = d.p.length / 2, now = Date.now();
      att.tok = Math.min(RL_CAP, (att.tok ?? RL_CAP) + (now - (att.ts || now)) / 1000 * RL_RATE); att.ts = now;
      if (att.tok < np) { ws.serializeAttachment(att); return; }
      att.tok -= np;
      let st = this.active.get(d.id);
      if (!st) {
        st = { id: d.id, c: sanitizeColor(d.c), w: clampW(d.w), p: [], ip: att.ip };
        this.active.set(d.id, st); this.strokes.push(st);
        if (this.strokes.length > MAX_STROKES) this.strokes.shift();
        if (this.active.size > 3000) this.active.clear();
      }
      const colChanged = att.col !== st.c; att.col = st.c; ws.serializeAttachment(att);
      for (let i = 0; i < d.p.length; i++) { const v = +d.p[i]; st.p.push(v < 0 ? 0 : v > 1 ? 1 : v || 0); }
      this.schedulePersist();
      const out = JSON.stringify({ t: 's', id: d.id, c: st.c, w: st.w, p: d.p });
      for (const s of this.state.getWebSockets()) if (s !== ws) { try { s.send(out); } catch {} }
      if (colChanged) this.presence();
    } else if (d.t === 'e') { this.active.delete(d.id); }
    else if (d.t === 'undo') { const i = this.strokes.findIndex(s => s.id === d.id && s.ip === att.ip); if (i >= 0) { this.strokes.splice(i, 1); this.active.delete(d.id); this.schedulePersist(); this.broadcast({ t: 'undo', id: d.id }); } }
    else if (d.t === 'vote') { att.voted = !att.voted; ws.serializeAttachment(att); this.tally(); }
    else if (d.t === 'report') { this.reports.push({ ts: Date.now(), by: att.ip, name: att.name }); if (this.reports.length > 300) this.reports.shift(); this.state.storage.put('reports', this.reports); }
    else if (d.t === 'cur') { const x = +d.x, y = +d.y; if (!(x >= 0 && x <= 1 && y >= 0 && y <= 1)) return; const out = JSON.stringify({ t: 'cur', id: att.cid, n: att.name, x, y, col: sanitizeColor(d.col) }); for (const s of this.state.getWebSockets()) if (s !== ws) { try { s.send(out); } catch {} } }
  }

  webSocketClose(ws) { const a = ws.deserializeAttachment(); if (a && a.cid) this.broadcast({ t: 'curgone', id: a.cid }); this.announce(); this.presence(); }
  webSocketError() { this.announce(); }

  broadcast(o) { const m = JSON.stringify(o); for (const s of this.state.getWebSockets()) { try { s.send(m); } catch {} } }
  presence() { const users = this.state.getWebSockets().map(s => { const a = s.deserializeAttachment() || {}; return { n: a.name || '?', c: a.country || '??', col: a.col || '#e50000' }; }); this.broadcast({ t: 'presence', users }); }
  voteState() { const all = this.state.getWebSockets(); let v = 0; for (const s of all) { const a = s.deserializeAttachment(); if (a && a.voted) v++; } return { votes: v, online: all.length, need: Math.max(2, Math.ceil(all.length * 0.6)) }; }
  announce() { const v = this.voteState(); this.broadcast({ t: 'n', online: v.online, votes: v.votes, need: v.need }); }
  tally() { const v = this.voteState(); if (v.votes >= v.need) { this.clearVotes(); this.reset(true); this.broadcast({ t: 'n', online: v.online, votes: 0, need: v.need }); } else this.broadcast({ t: 'n', online: v.online, votes: v.votes, need: v.need }); }
  clearVotes() { for (const s of this.state.getWebSockets()) { const a = s.deserializeAttachment(); if (a && a.voted) { a.voted = false; s.serializeAttachment(a); } } }

  schedulePersist() { if (this._pt) return; this._pt = setTimeout(() => { this._pt = null; this.persist(); }, 1500); }
  persist() { const j = JSON.stringify(this.strokes); this.sql.exec('DELETE FROM blob'); for (let i = 0; i < j.length; i += 100000) this.sql.exec('INSERT INTO blob(part) VALUES (?)', j.slice(i, i + 100000)); }

  async reset(broadcast = true) {
    this.strokes = []; this.active.clear(); this.sql.exec('DELETE FROM blob');
    this.day = todayUTC(); await this.state.storage.put('day', this.day);
    if (broadcast) this.broadcast({ t: 'reset' });
  }
  resync() { this.broadcast({ t: 'reset' }); for (let i = 0; i < this.strokes.length; i += 350) { const c = JSON.stringify({ t: 'load', strokes: this.strokes.slice(i, i + 350).map(s => ({ id: s.id, c: s.c, w: s.w, p: s.p })) }); for (const s of this.state.getWebSockets()) { try { s.send(c); } catch {} } } }
  kick(ip) { for (const s of this.state.getWebSockets()) { const a = s.deserializeAttachment(); if (a && a.ip === ip) { try { s.send(JSON.stringify({ t: 'banned' })); s.close(4003, 'banned'); } catch {} } } }
  async alarm() { await this.reset(true); await this.state.storage.setAlarm(nextMidnightUTC()); }

  async admin(req) {
    let body; try { body = await req.json(); } catch { body = {}; }
    const { action, arg } = body;
    if (action === 'wipe') { await this.reset(true); return json({ ok: true, wiped: true }); }
    if (action === 'ban' && arg) { this.banned.add(arg); await this.state.storage.put('banned', [...this.banned]); this.strokes = this.strokes.filter(s => s.ip !== arg); this.persist(); this.kick(arg); this.resync(); return json({ ok: true, banned: [...this.banned] }); }
    if (action === 'unban' && arg) { this.banned.delete(arg); await this.state.storage.put('banned', [...this.banned]); return json({ ok: true, banned: [...this.banned] }); }
    const conns = this.state.getWebSockets().map(s => { const a = s.deserializeAttachment() || {}; return { ip: a.ip, name: a.name, country: a.country }; });
    return json({ online: conns.length, connections: conns, banned: [...this.banned], reports: this.reports.slice(-50), strokes: this.strokes.length });
  }
}

export default { async fetch() { return new Response('cludraw DO host', { status: 404 }); } };
