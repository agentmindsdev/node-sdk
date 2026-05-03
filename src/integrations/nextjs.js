"use strict";
/**
 * Next.js helpers.
 *
 * Usage in `instrumentation.ts` (Next.js 13.4+):
 *
 *   export async function register() {
 *     if (process.env.NEXT_RUNTIME === "nodejs") {
 *       const agentminds = await import("agentminds");
 *       agentminds.init({ dsn: process.env.AGENTMINDS_DSN });
 *     }
 *   }
 *
 * Wrap App Router route handlers so request-scoped errors are captured:
 *
 *   import { wrapRouteHandler } from "agentminds/integrations/nextjs";
 *   export const GET = wrapRouteHandler(async (req) => { ... });
 */

const hub = require("../hub");

function wrapRouteHandler(handler) {
  return async function agentmindsWrappedHandler(req, ctx) {
    return hub.runWithScope(async () => {
      const url = req.url || "";
      const method = req.method || "GET";
      let route = url;
      try {
        route = new URL(url).pathname;
      } catch { /* relative or runtime URL */ }
      hub.setTransaction(`${method} ${route}`);
      hub.setTag("http.method", method);
      hub.setTag("http.route", route);
      hub.addBreadcrumb({ category: "http.server", message: `${method} ${route}` });
      const start = Date.now();
      try {
        const res = await handler(req, ctx);
        if (res && typeof res.status === "number" && res.status >= 500) {
          hub.captureEvent({
            type: "error",
            fingerprint: hub.fingerprint("http", res.status, route),
            page_url: url.slice(0, 512),
            payload: {
              kind: "http_5xx",
              status: res.status,
              method, path: route,
              duration_ms: Date.now() - start,
              scope: hub.scopeToDict(),
            },
          });
        }
        return res;
      } catch (err) {
        hub.captureException(err, {
          kind: "uncaught",
          http_method: method,
          http_path: route,
          duration_ms: Date.now() - start,
        });
        throw err;
      }
    });
  };
}

module.exports = { wrapRouteHandler };
