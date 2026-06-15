# Cludraw

A hosted shared pixel canvas - everyone draws on the same board in real time, and it persists. Drag to draw with a 16-colour palette. The canvas resets daily at 00:00 UTC.

## How it works

- A single **Cloudflare Worker + Durable Object** runs the whole thing - no separate database.
- The Durable Object (`Canvas`) holds the 128x128 grid in memory, **broadcasts each edit over WebSockets** to everyone connected, and **persists the grid to its own storage** (so it survives restarts/redeploys).
- New visitors receive the full grid on connect (sent as a binary blob), then live `{x, y, colour}` updates.
- A per-connection **token-bucket rate limit** (~50 px/sec) allows smooth drawing while stopping flood scripts.
- A **daily reset** is driven by a Durable Object alarm at midnight UTC (plus a lazy check on load).

## Run locally

```
npx wrangler dev
```

Opens at http://localhost:8787 - the Durable Object and WebSockets are simulated locally (no Cloudflare login needed).

## Deploy

```
npx wrangler deploy
```

Needs a Cloudflare API token (`CLOUDFLARE_API_TOKEN`) with Workers + Durable Objects permissions, or `wrangler login`. Durable Objects use the free-tier SQLite class (`new_sqlite_classes`).

## Files

- `src/worker.js` - the Worker entry + the `Canvas` Durable Object
- `public/` - the static frontend (served via Workers Static Assets)
- `wrangler.jsonc` - config (DO binding, migration, assets)
