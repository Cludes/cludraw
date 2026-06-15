// Operator endpoint, gated by the ADMIN_KEY secret (set on the Pages project).
//   /admin?key=SECRET&action=stats               -> who's online + ip-hashes + reports + bans
//   /admin?key=SECRET&action=wipe                -> instant panic wipe
//   /admin?key=SECRET&action=ban&arg=<ip-hash>   -> ban + remove their strokes + kick them
//   /admin?key=SECRET&action=unban&arg=<ip-hash> -> lift a ban
export async function onRequest({ request, env }) {
  const url = new URL(request.url);
  if (!env.ADMIN_KEY || url.searchParams.get('key') !== env.ADMIN_KEY) return new Response('forbidden', { status: 403 });
  const action = url.searchParams.get('action') || 'stats';
  const arg = url.searchParams.get('arg') || '';
  const stub = env.CANVAS.get(env.CANVAS.idFromName('global'));
  const r = await stub.fetch(new Request('https://do/admin', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action, arg }) }));
  return new Response(await r.text(), { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
}
