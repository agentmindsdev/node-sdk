"use strict";
/**
 * High-level helpers for the /sync API surface (Node port of sync.py).
 *
 * Customers integrating AgentMinds shouldn't have to hand-roll JSON
 * payloads, manage the X-AgentMinds-Key header, or remember canonical
 * metric names. Two halves:
 *
 *  PUSH (your data → AgentMinds):
 *    await agentminds.sync.report({
 *      apiKey: "sk_yoursite_xxx",
 *      siteId: "yoursite",
 *      agent: "security",
 *      metrics: { hsts_present: 1, csp_present: 1, ssl_days_remaining: 60 },
 *      warnings: [{ severity: "warning", message: "X" }],
 *      learnedPatterns: [{ pattern: "foo", category: "security",
 *                          confidence: 0.9, status: "active",
 *                          impact: "medium", detail: "y" }],
 *      projectInfo: { tech_stack: { framework: "Express" } },
 *    });
 *
 *  PULL (AgentMinds insights → your dashboard):
 *    const recs    = await agentminds.sync.recommendations({ apiKey, limit: 10 });
 *    const bench   = await agentminds.sync.benchmarks({ apiKey, siteId });
 *    const role    = await agentminds.sync.myRole({ apiKey });
 *    const pos     = await agentminds.sync.networkPosition({ apiKey });
 *    const issues  = await agentminds.sync.issues({ apiKey, status: "open" });
 *    const me      = await agentminds.sync.me({ apiKey });
 *
 * Auth + endpoint resolution:
 *   - apiKey + siteId can be passed directly OR read from env:
 *     AGENTMINDS_API_KEY, AGENTMINDS_SITE_ID
 *   - apiUrl defaults to https://api.agentminds.dev; override via
 *     AGENTMINDS_API or the apiUrl option
 *
 * Zero deps — uses Node's built-in https module, no axios/node-fetch.
 */

const https = require("https");
const http = require("http");
const { URL } = require("url");

const DEFAULT_API_BASE = "https://api.agentminds.dev";
const ARP_SCHEMA_URL = "https://agentminds.dev/arp/1.1.0";
const USER_AGENT = "agentminds-node/0.4.0";

class AgentMindsAPIError extends Error {
  constructor(status, body, message) {
    super(message || `HTTP ${status}: ${JSON.stringify(body).slice(0, 200)}`);
    this.name = "AgentMindsAPIError";
    this.status = status;
    this.body = body;
  }
}

function _resolveApiKey(apiKey) {
  const k = apiKey || process.env.AGENTMINDS_API_KEY || "";
  if (!k) {
    throw new AgentMindsAPIError(
      0, null,
      "apiKey required — pass it explicitly or set AGENTMINDS_API_KEY env var"
    );
  }
  return k;
}

function _resolveSiteId(siteId) {
  const s = siteId || process.env.AGENTMINDS_SITE_ID || "";
  if (!s) {
    throw new AgentMindsAPIError(
      0, null,
      "siteId required — pass it explicitly or set AGENTMINDS_SITE_ID env var"
    );
  }
  return s;
}

function _resolveApiBase(apiUrl) {
  const base = apiUrl || process.env.AGENTMINDS_API || DEFAULT_API_BASE;
  return base.replace(/\/+$/, "");
}

/**
 * One-shot HTTP with auth header + JSON encoding.
 * Resolves to { status, body }; never rejects on 4xx/5xx (caller checks status).
 */
function _http({ method, url, body, apiKey, timeoutMs = 30000 }) {
  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(url);
    } catch (e) {
      return reject(new AgentMindsAPIError(0, null, `bad url: ${url}`));
    }
    const lib = parsed.protocol === "http:" ? http : https;
    const data = body != null ? Buffer.from(JSON.stringify(body)) : null;
    const headers = {
      "User-Agent": USER_AGENT,
      "Accept": "application/json",
    };
    if (apiKey) headers["X-AgentMinds-Key"] = apiKey;
    if (data) {
      headers["Content-Type"] = "application/json";
      headers["Content-Length"] = data.length;
    }
    const req = lib.request(
      {
        method,
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === "http:" ? 80 : 443),
        path: parsed.pathname + (parsed.search || ""),
        headers,
        timeout: timeoutMs,
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf-8");
          let parsedBody = {};
          if (raw) {
            try {
              parsedBody = JSON.parse(raw);
            } catch (_e) {
              parsedBody = { error: raw.slice(0, 200) };
            }
          }
          resolve({ status: res.statusCode || 0, body: parsedBody });
        });
      }
    );
    req.on("timeout", () => {
      req.destroy();
      reject(new AgentMindsAPIError(0, null, `timeout after ${timeoutMs}ms`));
    });
    req.on("error", (e) => reject(new AgentMindsAPIError(0, null, e.message)));
    if (data) req.write(data);
    req.end();
  });
}

// ─── PUSH ───────────────────────────────────────────────────────────

/**
 * Push one agent report to /sync/report.
 *
 * @param {Object} opts
 * @param {string} opts.agent
 * @param {string} [opts.apiKey] — falls back to AGENTMINDS_API_KEY
 * @param {string} [opts.siteId] — falls back to AGENTMINDS_SITE_ID
 * @param {Object} [opts.metrics]
 * @param {Array}  [opts.warnings]
 * @param {Array}  [opts.recommendations]
 * @param {Array}  [opts.learnedPatterns]
 * @param {string} [opts.severity="info"]
 * @param {string} [opts.summary]
 * @param {Object} [opts.projectInfo]
 * @param {string} [opts.schemaUrl=ARP_SCHEMA_URL]
 * @param {string} [opts.apiUrl]
 * @param {number} [opts.timeoutMs=30000]
 * @returns {Promise<Object>} server response
 */
async function report(opts = {}) {
  const apiKey = _resolveApiKey(opts.apiKey);
  const siteId = _resolveSiteId(opts.siteId);
  const apiBase = _resolveApiBase(opts.apiUrl);
  const agent = opts.agent;
  if (!agent) throw new AgentMindsAPIError(0, null, "agent name is required");

  const summary = opts.summary || `${agent} report`;
  const payload = {
    site_id: siteId,
    agent,
    schema_url: opts.schemaUrl || ARP_SCHEMA_URL,
    report: {
      severity: opts.severity || "info",
      summary,
      metrics: opts.metrics || {},
      warnings: opts.warnings || [],
      recommendations: opts.recommendations || [],
    },
    memory: {
      learned_patterns: opts.learnedPatterns || [],
    },
  };
  if (opts.projectInfo) payload.project_info = opts.projectInfo;

  const { status, body } = await _http({
    method: "POST",
    url: `${apiBase}/api/v1/sync/report`,
    body: payload,
    apiKey,
    timeoutMs: opts.timeoutMs || 30000,
  });
  if (status >= 400) throw new AgentMindsAPIError(status, body);
  return body;
}

// ─── PULL ───────────────────────────────────────────────────────────

async function _get(path, opts = {}) {
  const apiKey = _resolveApiKey(opts.apiKey);
  const apiBase = _resolveApiBase(opts.apiUrl);
  const { status, body } = await _http({
    method: "GET",
    url: `${apiBase}${path}`,
    apiKey,
    timeoutMs: opts.timeoutMs || 15000,
  });
  if (status >= 400) throw new AgentMindsAPIError(status, body);
  return body;
}

/** GET /sync/me — your site's profile + meta. */
async function me(opts = {}) {
  return _get("/api/v1/sync/me", opts);
}

/** GET /sync/personalized-rules — top recommendations ranked for your stack. */
async function recommendations(opts = {}) {
  const limit = opts.limit || 30;
  return _get(`/api/v1/sync/personalized-rules?limit=${limit}`, opts);
}

/** GET /sync/benchmarks/{siteId} — your metrics vs network averages. */
async function benchmarks(opts = {}) {
  const siteId = _resolveSiteId(opts.siteId);
  const flag = opts.includeProvisional ? "?include_provisional=true" : "";
  return _get(`/api/v1/sync/benchmarks/${siteId}${flag}`, opts);
}

/** GET /sync/network-position — your overall score vs network p50/p90. */
async function networkPosition(opts = {}) {
  return _get("/api/v1/sync/network-position", opts);
}

/** GET /sync/my-role — donor / consumer / balanced classification. */
async function myRole(opts = {}) {
  return _get("/api/v1/sync/my-role", opts);
}

/** GET /sync/issues — open / resolved / muted / all issues for your site. */
async function issues(opts = {}) {
  const status = opts.status || "open";
  const limit = opts.limit || 100;
  return _get(`/api/v1/sync/issues?status=${status}&limit=${limit}`, opts);
}

/** GET /sync/actions — your action queue (LLM-derived recommendations). */
async function actions(opts = {}) {
  const status = opts.status || "all";
  const limit = opts.limit || 50;
  return _get(`/api/v1/sync/actions?status=${status}&limit=${limit}`, opts);
}

/** GET /sync/patterns — public pattern browser. Tier-2 visible only with apiKey. */
async function patterns(opts = {}) {
  const limit = opts.limit || 50;
  let qs = `?limit=${limit}`;
  if (opts.category) qs += `&category=${encodeURIComponent(opts.category)}`;
  if (opts.agent) qs += `&agent=${encodeURIComponent(opts.agent)}`;
  if (opts.impact) qs += `&impact=${encodeURIComponent(opts.impact)}`;
  return _get(`/api/v1/sync/patterns${qs}`, opts);
}

module.exports = {
  AgentMindsAPIError,
  ARP_SCHEMA_URL,
  report,
  me,
  recommendations,
  benchmarks,
  networkPosition,
  myRole,
  issues,
  actions,
  patterns,
};
