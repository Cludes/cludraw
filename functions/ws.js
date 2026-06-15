// Pages Function: routes /ws to the Canvas Durable Object (hosted in the cludraw-do Worker).
export async function onRequest({ request, env }) {
  if (request.headers.get('Upgrade') !== 'websocket') return new Response('expected websocket', { status: 426 });
  const id = env.CANVAS.idFromName('global');
  return env.CANVAS.get(id).fetch(request);
}
