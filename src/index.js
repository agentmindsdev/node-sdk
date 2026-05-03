"use strict";
/**
 * agentminds — Node.js SDK
 *
 * Sentry-style auto-capture for Node.js apps. One init() call hooks
 * uncaughtException + unhandledRejection process events; framework
 * integrations (express/fastify/nextjs) attach via their normal
 * middleware/plugin patterns.
 *
 *   const agentminds = require("agentminds");
 *   agentminds.init({ dsn: "https://pk_xxx@api.agentminds.dev/site_id" });
 *
 *   // express
 *   const { requestHandler, errorHandler } = require("agentminds/integrations/express");
 *   app.use(requestHandler());
 *   app.use(errorHandler()); // last middleware
 *
 *   // fastify
 *   fastify.register(require("agentminds/integrations/fastify"));
 *
 *   // next.js (instrumentation.ts)
 *   import { wrapRouteHandler } from "agentminds/integrations/nextjs";
 */

const { Client } = require("./client");
const { parseDSN, InvalidDSN } = require("./dsn");
const exceptions = require("./exceptions");
const hub = require("./hub");

const VERSION = "0.4.0";

/**
 * @typedef {Object} InitOptions
 * @property {string} [dsn] — Falls back to AGENTMINDS_DSN env var. SDK is a no-op if absent.
 * @property {string} [release] — Build identifier. Auto-detected from `git rev-parse --short HEAD` when omitted.
 * @property {string} [environment] — "production" / "staging" / "dev". Default "production".
 * @property {number} [sampleRate] — 0..1. Default 1.
 * @property {boolean} [debug] — Log SDK internals to console. Default false.
 * @property {boolean} [installExceptionHooks] — Hook process events. Default true.
 * @property {boolean} [sendDefaultPii] — Allow request bodies / user emails. Default false.
 */

/**
 * Initialise the SDK. Idempotent — second call replaces the prior client.
 * @param {InitOptions|string} [opts]
 * @returns {Client|null}
 */
function init(opts) {
  const o = typeof opts === "string" ? { dsn: opts } : (opts || {});
  const dsnStr = o.dsn || process.env.AGENTMINDS_DSN;
  if (!dsnStr) {
    if (o.debug) console.debug("[agentminds] no DSN — SDK is a no-op");
    hub.setClient(null);
    return null;
  }
  const dsn = parseDSN(dsnStr);
  const client = new Client({
    dsn,
    release: o.release || process.env.AGENTMINDS_RELEASE,
    environment: o.environment || process.env.AGENTMINDS_ENV || "production",
    sampleRate: o.sampleRate,
    debug: o.debug || process.env.AGENTMINDS_DEBUG === "1",
    sendDefaultPii: !!o.sendDefaultPii,
    version: VERSION,
  });
  hub.setClient(client);
  if (o.installExceptionHooks !== false) exceptions.install();

  // Code introspection — walk the host app's codebase ONCE at startup
  // and ship a "code signature" so AgentMinds knows what frameworks /
  // routes / deps it's monitoring. Best-effort, time-capped, never
  // raises out. Disable via init({ introspectCode: false }) or override
  // root via init({ projectRoot: "/path" }).
  if (o.introspectCode !== false) {
    try {
      const { pushCodeSignature } = require("./introspect");
      const sigHash = pushCodeSignature(client, o.projectRoot);
      if (o.debug && sigHash) {
        console.debug(`[agentminds] code signature shipped — hash=${sigHash}`);
      }
    } catch (e) {
      if (o.debug) console.debug(`[agentminds] introspection skipped — ${e.message}`);
    }
  }

  if (o.debug) {
    console.debug(`[agentminds] init OK — site=${dsn.siteId} release=${client.release} env=${client.environment}`);
  }
  return client;
}

async function flush(timeoutMs = 2000) {
  const c = hub.getClient();
  return c ? c.flush(timeoutMs) : true;
}

function close() {
  const c = hub.getClient();
  if (c) {
    c.close();
    hub.setClient(null);
  }
}

module.exports = {
  init,
  flush,
  close,
  // capture API
  captureException: hub.captureException,
  captureMessage: hub.captureMessage,
  captureEvent: hub.captureEvent,
  // scope API
  setUser: hub.setUser,
  setTag: hub.setTag,
  setExtra: hub.setExtra,
  setTransaction: hub.setTransaction,
  addBreadcrumb: hub.addBreadcrumb,
  clearScope: hub.clearScope,
  runWithScope: hub.runWithScope,
  // introspection
  isInitialized: hub.isInitialized,
  getClient: hub.getClient,
  // utility
  parseDSN,
  InvalidDSN,
  VERSION,
  // Canonical metric emitters (mirror of server registry)
  metrics: require("./metrics"),
  // High-level /sync/* API client (push reports, pull recommendations)
  sync: require("./sync"),
};
