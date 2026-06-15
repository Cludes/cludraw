# Cludraw

A hosted shared canvas - everyone draws on the same board in real time, and it persists. Live at **https://cludraw.pages.dev**.

Drag to draw with brush sizes, a 28-colour palette + a custom colour picker (any colour), and an eraser. The board resets daily at 00:00 UTC, or sooner if enough people **vote to wipe** it.

## Architecture

`.pages.dev` is a Cloudflare **Pages** URL, but the realtime engine is a **Durable Object** (a Worker feature), so it's two pieces:

- **`do/`** - a companion Worker (`cludraw-do`, `workers_dev: false`, no public URL) that defines the `Canvas` Durable Object: holds **vector strokes** (colour + width + resolution-independent points, so drawing is smooth/antialiased, not pixelated), broadcasts them over WebSockets, persists them in its own **SQLite** storage (no separate database), resets daily via an alarm, and tallies **vote-to-wipe** votes.
- **Pages project (`cludraw`)** - serves the static frontend (`public/`) and a `/ws` Pages Function (`functions/ws.js`) that is **bound to the Durable Object** (`script_name: cludraw-do`). This is the public `cludraw.pages.dev`.

New visitors get the full RGB grid as a binary blob on connect, then live `{x,y,r,g,b,s}` brush updates. A per-connection token-bucket rate limit (~300 px/sec) keeps drawing smooth while stopping flood scripts.

## Develop / deploy

```
# deploy the Durable Object worker first, then the Pages project
cd do && npx wrangler deploy
cd ..  && npx wrangler pages deploy
```

Needs a Cloudflare API token with Workers + Durable Objects + Pages permissions. CI: GitHub Action `.github/workflows/deploy.yml` deploys both on push (secrets `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID`).

## Files

- `do/worker.js` + `do/wrangler.jsonc` - the `Canvas` Durable Object host
- `functions/ws.js` - the Pages Function that routes `/ws` to the DO
- `public/` - the frontend (canvas, palette, brushes, vote UI)
- `wrangler.jsonc` - the Pages config (assets dir + DO binding)
