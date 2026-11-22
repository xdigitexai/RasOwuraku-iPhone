/**
 * RasOwuraku iPhones — static site server + Xdigitex Pay proxy
 *
 * Run:  node server.mjs
 * Demo: XDP_DEMO=1 node server.mjs     (simulates STK Push, no real prompt)
 *
 * The Xdigitex API sends no CORS headers, so the browser cannot call it
 * directly. This server serves the site and forwards /api/* upstream, adding
 * X-API-Key on the server. The key never reaches the browser.
 */
import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DEMO = process.env.XDP_DEMO === "1";
const CONFIG = {
  upstream: process.env.XDP_UPSTREAM || "https://pay.xdigitex.com",
  apiKey: process.env.XDP_API_KEY || "",
  port: Number(process.env.PORT || 3000),
};
const demo = { startedAt: 0, amount: 0, phone: "", reference: "" };

const MIME = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".xml": "application/xml; charset=utf-8",
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
  ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml",
  ".ico": "image/x-icon", ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
};

function send(res, status, body, type = "application/json; charset=utf-8") {
  res.writeHead(status, { "content-type": type, "cache-control": "no-store" });
  res.end(typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1024 * 1024) throw new Error("Request body too large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function demoResponse(method, pathname, payload) {
  if (pathname === "/api/payments/stkpush") {
    demo.startedAt = Date.now();
    demo.amount = Number(payload?.amount) || 0;
    demo.phone = String(payload?.phoneNumber || "");
    demo.reference = String(payload?.accountReference || "");
    return { status: 200, body: {
      checkoutRequestId: "ws_CO_DEMO_" + demo.startedAt,
      customerMessage: "Success. Request accepted for processing",
      status: "pending",
    }};
  }
  if (pathname.startsWith("/api/payments/status/")) {
    if (Date.now() - demo.startedAt > 5000) {
      return { status: 200, body: {
        checkoutRequestId: pathname.split("/").pop(),
        status: "completed",
        mpesaReceiptNumber: "QK71HL9XQ2",
        amount: demo.amount,
        phoneNumber: demo.phone,
        createdAt: new Date(demo.startedAt).toISOString(),
        updatedAt: new Date().toISOString(),
      }};
    }
    return { status: 200, body: {
      checkoutRequestId: pathname.split("/").pop(), status: "pending",
    }};
  }
  return { status: 404, body: { error: "NOT_FOUND", message: "No demo route for " + pathname } };
}

async function proxy(req, res, body, pathname) {
  if (DEMO) {
    let payload = {};
    try { payload = body.length ? JSON.parse(body.toString()) : {}; } catch {}
    const r = demoResponse(req.method, pathname, payload);
    await new Promise((resolve) => setTimeout(resolve, 350));
    return send(res, r.status, r.body);
  }

  if (!CONFIG.apiKey) {
    return send(res, 503, {
      error: "PAYMENT_NOT_CONFIGURED",
      message: "Set XDP_API_KEY in the environment, or start with XDP_DEMO=1 for testing.",
    });
  }

  try {
    const upstream = await fetch(CONFIG.upstream + req.url, {
      method: req.method,
      headers: {
        accept: "application/json",
        "content-type": req.headers["content-type"] || "application/json",
        "x-api-key": CONFIG.apiKey,
      },
      body: ["GET", "HEAD"].includes(req.method) ? undefined : body,
      redirect: "manual",
      signal: AbortSignal.timeout(30000),
    });
    const buffer = Buffer.from(await upstream.arrayBuffer());
    res.writeHead(upstream.status, {
      "content-type": upstream.headers.get("content-type") || "application/json; charset=utf-8",
      "cache-control": "no-store",
    });
    res.end(buffer);
  } catch (err) {
    send(res, 502, { error: "PAYMENT_GATEWAY_ERROR", message: `Cannot reach M-Pesa gateway: ${err.message}` });
  }
}

async function serveStatic(res, pathname) {
  const rel = pathname === "/" ? "index.html" : decodeURIComponent(pathname).replace(/^\/+/, "");
  const file = path.resolve(ROOT, rel);
  if (!file.startsWith(ROOT + path.sep) && file !== ROOT) return send(res, 403, { error: "FORBIDDEN" });
  try {
    const info = await stat(file);
    if (!info.isFile()) throw new Error("not a file");
    const body = await readFile(file);
    send(res, 200, body, MIME[path.extname(file).toLowerCase()] || "application/octet-stream");
  } catch {
    send(res, 404, { error: "NOT_FOUND", message: "File not found: " + rel });
  }
}

const server = http.createServer(async (req, res) => {
  const pathname = new URL(req.url, `http://${req.headers.host || "localhost"}`).pathname;
  if (req.method === "OPTIONS") return send(res, 204, "");

  if (pathname === "/api/config") {
    return send(res, 200, {
      basePath: "/api",
      configured: DEMO || Boolean(CONFIG.apiKey),
      demo: DEMO,
    });
  }
  if (pathname.startsWith("/api/")) {
    let body;
    try { body = await readBody(req); }
    catch (err) { return send(res, 413, { error: "BAD_REQUEST", message: err.message }); }
    return proxy(req, res, body, pathname);
  }
  return serveStatic(res, pathname);
});

server.listen(CONFIG.port, () => {
  console.log(`Store:    http://localhost:${CONFIG.port}`);
  console.log(`Payment:  ${DEMO ? "DEMO MODE (simulated STK Push)" : CONFIG.apiKey ? "live via " + CONFIG.upstream : "NOT CONFIGURED — set XDP_API_KEY"}`);
});
