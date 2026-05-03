"use strict";
/**
 * Fastify plugin.
 *
 * Usage:
 *   const fastify = require("fastify")();
 *   const agentminds = require("agentminds");
 *   const agentmindsFastify = require("agentminds/integrations/fastify");
 *
 *   agentminds.init({ dsn: "..." });
 *   fastify.register(agentmindsFastify);
 */

const hub = require("../hub");

async function plugin(fastify) {
  fastify.addHook("onRequest", (req, reply, done) => {
    hub.runWithScope(() => {
      const route = req.routerPath || req.url;
      hub.setTransaction(`${req.method} ${route}`);
      hub.setTag("http.method", req.method);
      hub.setTag("http.route", route);
      hub.addBreadcrumb({
        category: "http.server",
        message: `${req.method} ${route}`,
      });
      req._am_start = Date.now();
      done();
    });
  });

  fastify.addHook("onError", (req, reply, err, done) => {
    try {
      hub.captureException(err, {
        kind: "uncaught",
        http_method: req.method,
        http_path: req.url,
      });
    } catch { /* swallow */ }
    done();
  });

  fastify.addHook("onResponse", (req, reply, done) => {
    if (reply.statusCode >= 500) {
      hub.captureEvent({
        type: "error",
        fingerprint: hub.fingerprint("http", reply.statusCode, req.url),
        page_url: (req.url || "").slice(0, 512),
        payload: {
          kind: "http_5xx",
          status: reply.statusCode,
          method: req.method,
          path: req.url,
          duration_ms: Date.now() - (req._am_start || Date.now()),
          scope: hub.scopeToDict(),
        },
      });
    }
    done();
  });
}

// Fastify expects the plugin export to be tagged so it registers properly.
plugin[Symbol.for("skip-override")] = true;
plugin[Symbol.for("fastify.display-name")] = "agentminds";

module.exports = plugin;
module.exports.default = plugin;
