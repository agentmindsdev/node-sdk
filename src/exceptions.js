"use strict";
/**
 * Hook process-wide error events:
 *   - 'uncaughtException'      — synchronous uncaught throws
 *   - 'unhandledRejection'     — promises rejected without a .catch()
 *
 * We attach as listeners (not handlers), so we don't change Node's default
 * behavior of crashing on uncaughtException — we just get a chance to
 * ship the event to AgentMinds first.
 */

const hub = require("./hub");

let _installed = false;

function install() {
  if (_installed) return;
  _installed = true;

  process.on("uncaughtException", (err, origin) => {
    try {
      hub.captureException(err, { kind: "uncaught", origin });
      const c = hub.getClient();
      if (c) c.flush(2000).catch(() => {});
    } catch {
      // Never throw out of an exception handler.
    }
  });

  process.on("unhandledRejection", (reason) => {
    try {
      const err = reason instanceof Error ? reason : new Error(String(reason));
      hub.captureException(err, { kind: "unhandled_rejection" });
    } catch {
      // swallow
    }
  });
}

module.exports = { install };
