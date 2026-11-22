# Storefront setup

Prices are displayed in KSh and the shop location is Nairobi, Kenya.

## Run locally

```bash
cd RasOwuraku-iPhone
node server.mjs
```

Open <http://localhost:3000> and use the shop normally.

## M-Pesa payment fix

The old `shop.html` called `https://pay.xdigitex.com/api` directly from the browser with
`PASTE_YOUR_XDIGITEX_API_KEY_HERE`. That failed for two reasons:

1. The key was a placeholder, so the API returned `INVALID_CREDENTIALS`.
2. The Xdigitex API sends no `Access-Control-Allow-Origin` header, so browsers block
   cross-origin requests even with a valid key.

`server.mjs` fixes both: it serves the site and proxies `/api/*` to the real API,
injecting `X-API-Key` on the server. The browser never sees the key.

### Live payments

```bash
XDP_API_KEY=xdp_live_xxxxxxxx PORT=3000 node server.mjs
```

Never put the key in `shop.html` or commit it to GitHub.

### Test without a phone

```bash
XDP_DEMO=1 node server.mjs
```

This simulates STK Push: the prompt is accepted, the status poll stays `pending`
for 5 seconds, then returns `completed` with a demo receipt. No real money moves.

## Deployment

GitHub Pages cannot run the proxy, so payments will not work on a static-only host.
Deploy `server.mjs` on a Node host (Render, Fly.io, VPS, etc.), set `XDP_API_KEY`
as a server environment variable, and serve the same folder from it.

A production flow should also validate product prices and order totals on the
server instead of trusting values from the browser.

## Before launch

- Confirm the real selling prices — the existing catalogue numbers are placeholders.
- Rotate any API key previously pasted into chat or public code.
- Add a verified WhatsApp business number if direct chat links are needed.
