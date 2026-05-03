"use strict";
/**
 * Logger transports for popular Node logging libraries.
 *
 * Winston:
 *   const winston = require("winston");
 *   const { WinstonTransport } = require("agentminds/integrations/logger");
 *   const logger = winston.createLogger({
 *     transports: [new WinstonTransport({ level: "warn" })],
 *   });
 *
 * Pino:
 *   const pino = require("pino");
 *   const { pinoStream } = require("agentminds/integrations/logger");
 *   const logger = pino({ level: "warn" }, pinoStream());
 *
 * Bare logger (console.error wrapper):
 *   const { wrapConsoleError } = require("agentminds/integrations/logger");
 *   wrapConsoleError(); // forwards every console.error to AgentMinds
 */

const hub = require("../hub");

let WinstonTransport;
try {
  // Lazy-load winston-transport so we don't require winston as a dep.
  const Transport = require("winston-transport");
  WinstonTransport = class extends Transport {
    constructor(opts = {}) {
      super(opts);
      this.name = "agentminds";
      this.eventLevel = opts.eventLevel || "warn";
    }
    log(info, callback) {
      try {
        const lvl = (info[Symbol.for("level")] || info.level || "info").toLowerCase();
        const eventLevels = ["error", "fatal", "warn", "warning"];
        if (eventLevels.includes(lvl)) {
          if (info.stack || info instanceof Error) {
            const err = info instanceof Error ? info : Object.assign(new Error(info.message), { stack: info.stack });
            hub.captureException(err, { logger: "winston", level: lvl });
          } else {
            hub.captureMessage(info.message, lvl, { logger: "winston" });
          }
        } else {
          hub.addBreadcrumb({
            category: "log.winston",
            message: String(info.message).slice(0, 500),
            level: lvl,
          });
        }
      } catch { /* swallow */ }
      if (callback) callback();
    }
  };
} catch {
  WinstonTransport = null;
}

function pinoStream() {
  return {
    write(line) {
      try {
        const obj = JSON.parse(line);
        const lvl = pinoLevel(obj.level);
        if (lvl === "error" || lvl === "fatal" || lvl === "warn") {
          if (obj.err && obj.err.stack) {
            const err = Object.assign(new Error(obj.err.message), { stack: obj.err.stack });
            hub.captureException(err, { logger: "pino", level: lvl });
          } else {
            hub.captureMessage(obj.msg || "", lvl, { logger: "pino" });
          }
        } else {
          hub.addBreadcrumb({
            category: "log.pino",
            message: String(obj.msg || "").slice(0, 500),
            level: lvl,
          });
        }
      } catch { /* not JSON or not a pino line — ignore */ }
    },
  };
}

function pinoLevel(n) {
  // pino numeric levels
  if (n >= 60) return "fatal";
  if (n >= 50) return "error";
  if (n >= 40) return "warn";
  if (n >= 30) return "info";
  if (n >= 20) return "debug";
  return "trace";
}

function wrapConsoleError() {
  const orig = console.error.bind(console);
  console.error = function (...args) {
    try {
      const msg = args.map((a) => (a instanceof Error ? a.stack || a.message : String(a))).join(" ");
      const err = args.find((a) => a instanceof Error);
      if (err) {
        hub.captureException(err, { logger: "console" });
      } else {
        hub.captureMessage(msg.slice(0, 500), "error", { logger: "console" });
      }
    } catch { /* swallow */ }
    orig(...args);
  };
}

module.exports = { WinstonTransport, pinoStream, wrapConsoleError };
