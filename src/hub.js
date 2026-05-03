"use strict";
/**
 * Global hub + per-async-context scope using AsyncLocalStorage so
 * concurrent requests in a Node process don't bleed user/tag state
 * into each other.
 *
 * Sentry-equivalent of Hub.current + Scope.
 */

const { AsyncLocalStorage } = require("node:async_hooks");

let _client = null;
const _als = new AsyncLocalStorage();

function setClient(c) { _client = c; }
function getClient() { return _client; }
function isInitialized() { return _client != null; }

// ── Scope ──────────────────────────────────────────────────────────

function newScope() {
  return {
    user: null,
    tags: {},
    extras: {},
    breadcrumbs: [],
    transaction: null,
  };
}

/** Run `fn` inside an isolated scope. Anything set inside is visible
 *  only to fn and its async descendants — perfect for per-request scope. */
function runWithScope(fn) {
  return _als.run(newScope(), fn);
}

function _scope() {
  // Outside an ALS context (e.g. cron job), share a process-wide scope.
  return _als.getStore() || _processScope;
}
const _processScope = newScope();

function setUser(u) { _scope().user = u; }
function setTag(k, v) {
  _scope().tags[String(k).slice(0, 64)] = String(v).slice(0, 200);
}
function setExtra(k, v) { _scope().extras[String(k).slice(0, 64)] = v; }
function setTransaction(name) { _scope().transaction = name; }
function clearScope() {
  const s = _scope();
  s.user = null;
  s.tags = {};
  s.extras = {};
  s.breadcrumbs = [];
  s.transaction = null;
}

const MAX_BREADCRUMBS = 100;
function addBreadcrumb({ category = "default", message = "", level = "info", data = null } = {}) {
  const s = _scope();
  s.breadcrumbs.push({
    ts: Date.now() / 1000,
    category: String(category).slice(0, 32),
    message: String(message).slice(0, 500),
    level,
    data: data || {},
  });
  if (s.breadcrumbs.length > MAX_BREADCRUMBS) {
    s.breadcrumbs.splice(0, s.breadcrumbs.length - MAX_BREADCRUMBS);
  }
}

function scopeToDict(s = _scope()) {
  const d = {};
  if (s.user) d.user = s.user;
  if (Object.keys(s.tags).length) d.tags = { ...s.tags };
  if (Object.keys(s.extras).length) d.extras = { ...s.extras };
  if (s.breadcrumbs.length) d.breadcrumbs = s.breadcrumbs.slice();
  if (s.transaction) d.transaction = s.transaction;
  return d;
}

// ── Capture ────────────────────────────────────────────────────────

function fingerprint(...parts) {
  // djb2 → hex (same shape as the agent.js / Python fingerprints)
  let h = 5381;
  for (const p of parts) {
    const s = String(p ?? "");
    for (let i = 0; i < s.length; i++) {
      h = ((h << 5) + h + s.charCodeAt(i)) & 0xffffffff;
    }
  }
  return (h >>> 0).toString(16);
}

function _parseStack(err) {
  const stack = err && err.stack ? String(err.stack) : "";
  // First "    at file:line:col" or "    at fn (file:line:col)"
  const m = stack.match(/\n\s*at\s+(?:[^\(]+\()?([^:\s\)]+):(\d+):(\d+)/);
  return {
    stack: stack.slice(0, 8000),
    source: m ? m[1].slice(0, 300) : "",
    line: m ? parseInt(m[2], 10) : 0,
    column: m ? parseInt(m[3], 10) : 0,
  };
}

function captureException(err, extra = {}) {
  const c = getClient();
  if (!c) return;
  if (err == null) return;
  const e = err instanceof Error ? err : new Error(String(err));
  const { stack, source, line, column } = _parseStack(e);
  const msg = `${e.name}: ${e.message}`.slice(0, 500);
  const ev = {
    type: "error",
    fingerprint: fingerprint(e.name, source, line),
    payload: {
      kind: extra.kind === "uncaught" ? "uncaught" : "captured",
      message: msg,
      exception_type: e.name,
      source,
      line,
      column,
      stack,
      ...Object.fromEntries(Object.entries(extra).filter(([k]) => k !== "kind")),
      scope: scopeToDict(),
    },
  };
  c.enqueue(ev);
}

function captureMessage(message, level = "info", extra = {}) {
  const c = getClient();
  if (!c) return;
  const ev = {
    type: level === "info" ? "custom" : "error",
    fingerprint: fingerprint("msg", String(message).slice(0, 64), level),
    payload: {
      kind: "message",
      level,
      message: String(message).slice(0, 1000),
      ...extra,
      scope: scopeToDict(),
    },
  };
  c.enqueue(ev);
}

function captureEvent(event) {
  const c = getClient();
  if (c) c.enqueue(event);
}

module.exports = {
  setClient, getClient, isInitialized,
  runWithScope, clearScope,
  setUser, setTag, setExtra, setTransaction, addBreadcrumb,
  scopeToDict,
  captureException, captureMessage, captureEvent,
  fingerprint,
};
