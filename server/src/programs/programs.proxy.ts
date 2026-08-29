import type { IncomingMessage, ServerResponse } from "node:http";
import type { Socket } from "node:net";
import type { Duplex } from "node:stream";
import type { RequestHandler } from "express";
import httpProxy from "http-proxy";
import { config } from "../config.js";
import { isProgramId } from "./programs.js";
import type { ProgramId } from "@overlay/shared";

/**
 * Same-origin reverse proxy for the two program UIs, so the sidebar
 * "Dashboards" tiles can iframe them from any device (kiosk over HTTP,
 * iPad over the Caddy/Authelia HTTPS edge) with no CORS, no mixed content
 * and no X-Frame-Options fight — the iframe src is just `/x/<id>/`.
 *
 * Two flavours:
 *  - Programs that can serve under their own `/x/<id>` base path (Streamlit
 *    `--server.baseUrlPath`, Next.js `basePath`) get the path forwarded
 *    verbatim — assets and the Streamlit websocket already come back prefixed.
 *  - Programs that only serve at root (the Nachhilfelehrer Express app) are in
 *    `SERVES_AT_ROOT`: we strip the `/x/<id>` prefix before forwarding. Their
 *    assets must be relative; a small fetch shim in the app re-prefixes the
 *    absolute `/api/` calls so everything still arrives here under `/x/<id>`.
 */

/** Program ids whose backend serves at `/`, not under `/x/<id>`. */
const SERVES_AT_ROOT = new Set<ProgramId>(["ki-nachhilfe"]);

// Origin (scheme + host:port) of each program, from its configured app URL —
// the request path is forwarded as-is. A bad URL just disables that program.
function targetFor(id: ProgramId): string | null {
  const raw = id === "aktien" ? config.AKTIEN_APP_URL : config.KI_NACHHILFE_APP_URL;
  try {
    const u = new URL(raw);
    return `${u.protocol}//${u.host}`;
  } catch {
    return null;
  }
}

const proxy = httpProxy.createProxyServer({
  // Keep the original Host (the Overlay's own host:port). The programs build
  // absolute URLs from it — Streamlit's trailing-slash redirect, its
  // websocket Origin/XSRF check — so they must resolve back to the Overlay
  // origin, not the internal 127.0.0.1:<port>. A cross-origin redirect here
  // would be blocked by the page CSP (frame-src 'self') and show as a broken
  // iframe. autoRewrite fixes any Location header the same way as a fallback.
  changeOrigin: false,
  autoRewrite: true,
  xfwd: true,
  ws: true,
  // Streamlit reruns can take a while; don't kill an otherwise-fine stream.
  proxyTimeout: 0,
});

// These apps are meant to be embedded in the Overlay now; drop headers that
// would break the iframe (the Overlay page's own CSP already scopes framing).
proxy.on("proxyRes", (proxyRes) => {
  delete proxyRes.headers["x-frame-options"];
  delete proxyRes.headers["content-security-policy"];
});

proxy.on("error", (err, _req, res) => {
  // res is a ServerResponse for web(), or a Socket for ws()
  if (res && "writeHead" in res && !(res as ServerResponse).headersSent) {
    (res as ServerResponse).writeHead(502, { "Content-Type": "text/plain; charset=utf-8" });
    (res as ServerResponse).end(`Programm nicht erreichbar: ${(err as Error).message}`);
  } else if (res && "destroy" in res) {
    (res as Socket).destroy();
  }
});

/** First path segment after the mount point, e.g. "/aktien/foo" -> "aktien". */
function idFromPath(path: string): ProgramId | null {
  const seg = path.split("/").filter(Boolean)[0];
  return seg && isProgramId(seg) ? seg : null;
}

/** Mounted at `/x`. Forwards `/x/<id>/...` to that program. */
export const programsProxyMiddleware: RequestHandler = (req, res, next) => {
  const id = idFromPath(req.path);
  if (!id) return next();
  const target = targetFor(id);
  if (!target) {
    res.status(503).type("text/plain").send("Programm ist nicht konfiguriert.");
    return;
  }
  // Express strips the `/x` mount prefix from req.url; here it is `/<id>/...`.
  if (SERVES_AT_ROOT.has(id)) {
    const rest = req.url.slice(("/" + id).length);
    // Keep the app on a trailing slash so its relative assets and the fetch
    // shim resolve against `/x/<id>/`.
    if (rest === "") {
      res.redirect(308, `/x/${id}/`);
      return;
    }
    req.url = rest;
  } else {
    // The program serves under that same `/x/<id>` base path — put it back.
    req.url = "/x" + req.url;
  }
  proxy.web(req, res, { target });
};

/**
 * Called from the http server's `upgrade` handler before the app's own
 * websocket router. Returns true if it took the socket (a `/x/<id>/...`
 * websocket, e.g. Streamlit's `_stcore/stream`).
 */
export function tryProxyUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): boolean {
  const path = new URL(req.url ?? "/", "http://localhost").pathname;
  if (!path.startsWith("/x/")) return false;
  const id = idFromPath(path.slice(2));
  if (!id) return false;
  const target = targetFor(id);
  if (!target) {
    socket.destroy();
    return true;
  }
  if (SERVES_AT_ROOT.has(id) && req.url) {
    req.url = req.url.slice(("/x/" + id).length) || "/";
  }
  proxy.ws(req, socket as Socket, head, { target });
  return true;
}
