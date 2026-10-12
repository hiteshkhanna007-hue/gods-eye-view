# Deploying to Vercel

The static app builds with `npm run build`. The `/api/*` routes run as one
Vercel function, `api/gev.js`, which installs the same provider middleware as
the dev/preview server (`server/vercel/handler.js`). `vercel.json` routes
every `/api/*` request to it.

## Setup

1. Import the repository at <https://vercel.com/new>. The settings come from
   `vercel.json`; Node 24 comes from `engines` in `package.json`.
2. Add any keys from `.env.example` under **Settings → Environment
   Variables**. The in-app POWER UP panel cannot write keys on Vercel.
3. Deploy.

## Before adding paid keys

A public deployment brokers your keys to anyone who has the URL. The
same-origin gates still refuse cross-site requests and the per-IP throttles
apply (keyed on Vercel's client address), but neither is a billing cap.
Turn on **Deployment Protection** (Settings → Deployment Protection) for a
private copy, and set provider-side quotas and budget alerts.

## Differences from running locally

- **Not available:** the key-setup panel, local ADS-B receivers, Codex OAuth
  voice login and `/mcp`. They are local-only by design.
- **Caches** are written to `/tmp` and last only as long as a warm function
  instance, so cold starts refetch from upstream.
- **AIS live vessels** keep a websocket open between requests. A serverless
  instance is frozen between requests, so the vessel feed is best-effort.
