// Pages Function: routes /ws to the Canvas Durable Object (hosted in the cludraw-do Worker).
export async function onRequest({ request, env }) {
  if (request.headers.get('Upgrade') !== 'websocket') return new Response('expected websocket', { status: 426 });
  const room = (new URL(request.url).searchParams.get('room') || 'global').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 24) || 'global';
  return env.CANVAS.get(env.CANVAS.idFromName(room)).fetch(request);
}
