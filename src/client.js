"use strict";
/**
 * HTTP client — buffered queue + interval flush.
 *
 * Uses Node's built-in http/https so the SDK has zero deps.
 * Capture is O(1) (push to in-memory queue); the worker timer
 * drains every FLUSH_INTERVAL_MS or when queue >= FLUSH_THRESHOLD.
 */

const http = require("node:http");
const https = require("node:https");
const os = require("node:os");
const { URL } = require("node:url");
const { execSync } = require("node:child_process");

const FLUSH_INTERVAL_MS = 5000;
const FLUSH_THRESHOLD = 30;
const MAX_QUEUE = 1000;
const HTTP_TIMEOUT_MS = 8000;

class Client {
  constructor(opts) {
    this.dsn = opts.dsn;
    this.release = opts.release || detectRelease();
    this.environment = opts.environment || "production";
    this.sampleRate = clamp(opts.sampleRate ?? 1.0, 0, 1);
    this.debug = !!opts.debug;
    this.sendDefaultPii = !!opts.sendDefaultPii;
    this.version = opts.version || "0.1.0";

    this._queue = [];
    this._closed = false;
    this._hostname = os.hostname();
    this._runtime = `node/${process.version.replace(/^v/, "")}`;

    this._timer = setInterval(() => this._flush(false), FLUSH_INTERVAL_MS);
    if (this._timer.unref) this._timer.unref();

    // Final flush on process exit (best-effort, sync)
    this._exitHandler = () => this._flushSync();
    process.once("exit", this._exitHandler);
    process.once("beforeExit", this._exitHandler);
  }

  enqueue(event) {
    if (this._closed) return;
    if (this.sampleRate < 1.0 && Math.random() > this.sampleRate) return;

    if (!event.payload) event.payload = {};
    const meta = (event.payload.meta = event.payload.meta || {});
    if (meta.hostname == null) meta.hostname = this._hostname;
    if (meta.runtime == null) meta.runtime = this._runtime;
    if (this.environment && meta.environment == null) meta.environment = this.environment;
    if (this.release && meta.release == null) meta.release = this.release;

    if (this._queue.length >= MAX_QUEUE) this._queue.shift();
    this._queue.push(event);

    if (this._queue.length >= FLUSH_THRESHOLD) this._flush(false);
  }

  async flush(timeoutMs = 2000) {
    const deadline = Date.now() + timeoutMs;
    this._flush(false);
    while (this._queue.length > 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 50));
    }
    return this._queue.length === 0;
  }

  close() {
    if (this._closed) return;
    this._closed = true;
    clearInterval(this._timer);
    this._flushSync();
    process.removeListener("exit", this._exitHandler);
    process.removeListener("beforeExit", this._exitHandler);
  }

  _flush(/* sync */) {
    if (this._queue.length === 0) return;
    const batch = this._queue.splice(0, this._queue.length);
    const body = JSON.stringify({ events: batch });
    const url = new URL(this.dsn.ingestUrl);
    const lib = url.protocol === "https:" ? https : http;
    const req = lib.request(
      {
        method: "POST",
        hostname: url.hostname,
        port: url.port || (url.protocol === "https:" ? 443 : 80),
        path: url.pathname + url.search,
        timeout: HTTP_TIMEOUT_MS,
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
          "User-Agent": `agentminds-node/${this.version}`,
        },
      },
      (res) => {
        // Drain response so socket can be reused
        res.resume();
        if (this.debug && res.statusCode >= 400) {
          console.warn(`[agentminds] HTTP ${res.statusCode} — dropped ${batch.length} events`);
        } else if (this.debug) {
          console.debug(`[agentminds] sent ${batch.length} events → HTTP ${res.statusCode}`);
        }
      },
    );
    req.on("error", (e) => {
      if (this.debug) {
        console.warn(`[agentminds] send failed (${e.code || e.message}) — dropped ${batch.length} events`);
      }
    });
    req.on("timeout", () => req.destroy());
    req.write(body);
    req.end();
  }

  _flushSync() {
    // Sync-on-exit best effort: kick off async flush and let event loop
    // drain naturally. Node will wait for the request to complete during
    // 'beforeExit' but not during 'exit' — we accept partial loss there.
    this._flush(true);
  }
}

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

function detectRelease() {
  if (process.env.AGENTMINDS_RELEASE) return process.env.AGENTMINDS_RELEASE;
  try {
    const out = execSync("git rev-parse --short HEAD", {
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 2000,
    });
    return out.toString("utf8").trim() || null;
  } catch {
    return null;
  }
}

module.exports = { Client, detectRelease };
