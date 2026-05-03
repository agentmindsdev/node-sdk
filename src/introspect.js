"use strict";
/**
 * Code introspection — auto-extract patterns from the host app at init.
 *
 * Mirror of the Python SDK's _introspect.py. We don't pull in a JS AST
 * parser as a dependency (would break the zero-deps promise), so this
 * is regex-based. Less precise than ast.parse but covers the cases
 * worth tracking: imports, framework markers, decorator-style and
 * router-style HTTP routes.
 *
 * What we extract:
 *   - Top-level dependency names from import / require
 *   - Frameworks detected from those imports (express, fastify, nestjs,
 *     next, koa, …)
 *   - HTTP routes via app.get('/path'), router.post('/path'),
 *     fastify.get('/path'), Next.js App Router export consts (best-effort)
 *   - Async-arrow vs function ratio
 *   - Test file count
 *
 * What we DO NOT extract:
 *   - Function bodies, comments, JSDoc
 *   - String literals (could be secrets)
 *   - Anything outside the project root
 *
 * Capped at MAX_FILES files, MAX_FILE_BYTES per file, depth MAX_DEPTH,
 * total wall-clock SCAN_TIMEOUT_MS. Init never blocks.
 */

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const MAX_FILES = 800;
const MAX_FILE_BYTES = 200 * 1024;
const MAX_DEPTH = 6;
const SCAN_TIMEOUT_MS = 5000;

const SOURCE_EXTS = new Set([".js", ".mjs", ".cjs", ".ts", ".tsx"]);

const SKIP_DIRS = new Set([
  ".git", ".hg", ".svn", "node_modules", "dist", "build", ".next",
  "out", "target", ".idea", ".vscode", ".turbo", ".cache", ".parcel-cache",
  "coverage", ".nyc_output", ".tox", ".pytest_cache", "vendor",
]);

const FRAMEWORK_MARKERS = {
  // Web frameworks
  "express": "express",
  "fastify": "fastify",
  "koa": "koa",
  "@hapi/hapi": "hapi",
  "@nestjs/core": "nestjs",
  "@nestjs/common": "nestjs",
  "next": "nextjs",
  "react": "react",
  "vue": "vue",
  "@angular/core": "angular",
  "svelte": "svelte",
  // DB / cache
  "pg": "postgres",
  "mysql": "mysql",
  "mysql2": "mysql",
  "mongodb": "mongodb",
  "mongoose": "mongodb",
  "redis": "redis",
  "ioredis": "redis",
  "prisma": "prisma",
  "@prisma/client": "prisma",
  // Cloud / infra
  "@aws-sdk/client-s3": "aws",
  "aws-sdk": "aws",
  "stripe": "stripe",
  // LLM
  "@anthropic-ai/sdk": "anthropic",
  "openai": "openai",
  // Telemetry siblings
  "@sentry/node": "sentry",
  "@sentry/nextjs": "sentry",
  "@agentmindsdev/node": "agentminds",
};

const ROUTE_METHODS = new Set([
  "get", "post", "put", "delete", "patch", "options", "head", "all",
]);

// ---- regex patterns (compiled once) ----------------------------------

// Match `import x from "pkg"`, `import { x } from "pkg"`, `import "pkg"`
const IMPORT_RE = /import\s+(?:[^'"]+?\s+from\s+)?['"]([^'"]+)['"]/g;
// Match `require("pkg")`
const REQUIRE_RE = /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
// Match `app.get('/path', ...)`, `router.post("/x", …)`, `fastify.get('/y', …)`
// where the receiver name is a plain identifier (we accept any caller
// — not perfect, but the literal-string + method pair filters most noise).
const ROUTE_RE = /\b(?:[a-zA-Z_$][\w$]*)\.(get|post|put|delete|patch|options|head|all)\s*\(\s*['"]([^'"]{1,200})['"]/g;
// Async function / arrow detection — coarse but useful as a ratio.
const ASYNC_FN_RE = /\basync\s+(?:function|\([^)]*\)\s*=>|[a-zA-Z_$][\w$]*\s*=>)/g;
const ANY_FN_RE = /\bfunction\b|=>/g;

function _walkSourceFiles(root, deadline) {
  const found = [];
  const rootResolved = path.resolve(root);
  const rootDepth = rootResolved.split(path.sep).filter(Boolean).length;

  function step(dir) {
    if (Date.now() > deadline) return false;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return true;
    }
    const dirDepth = dir.split(path.sep).filter(Boolean).length - rootDepth;
    if (dirDepth > MAX_DEPTH) return true;

    for (const ent of entries) {
      if (Date.now() > deadline) return false;
      const name = ent.name;
      if (ent.isDirectory()) {
        if (SKIP_DIRS.has(name) || name.startsWith(".")) continue;
        const ok = step(path.join(dir, name));
        if (!ok) return false;
        if (found.length >= MAX_FILES) return false;
      } else if (ent.isFile()) {
        const ext = path.extname(name).toLowerCase();
        if (!SOURCE_EXTS.has(ext)) continue;
        // Skip declaration files — only types, no code structure
        if (name.endsWith(".d.ts")) continue;
        const full = path.join(dir, name);
        try {
          const stat = fs.statSync(full);
          if (stat.size > MAX_FILE_BYTES) continue;
        } catch {
          continue;
        }
        found.push(full);
        if (found.length >= MAX_FILES) return false;
      }
    }
    return true;
  }
  step(rootResolved);
  return found;
}

function extractCodeSignature(root) {
  if (root == null) root = process.cwd();
  let stat;
  try {
    stat = fs.statSync(root);
  } catch {
    return { error: "root not readable", root: String(root) };
  }
  if (!stat.isDirectory()) {
    return { error: "root not a directory", root: String(root) };
  }

  const deadline = Date.now() + SCAN_TIMEOUT_MS;
  const rootResolved = path.resolve(root);
  const files = _walkSourceFiles(rootResolved, deadline);

  if (files.length === 0) {
    return {
      language: "node",
      root_basename: path.basename(rootResolved),
      file_count: 0,
      skipped: true,
      reason: "no JS/TS files under root",
    };
  }

  const imports = new Map();
  const routes = [];
  const topDirs = new Map();
  let asyncFunctionCount = 0;
  let totalFunctionCount = 0;
  let testFiles = 0;
  let parseErrors = 0;
  let timedOut = false;

  for (const file of files) {
    if (Date.now() > deadline) {
      timedOut = true;
      break;
    }
    const rel = path.relative(rootResolved, file);
    const parts = rel.split(path.sep);
    if (parts.length > 1) {
      topDirs.set(parts[0], (topDirs.get(parts[0]) || 0) + 1);
    }
    const baseLower = path.basename(file).toLowerCase();
    if (baseLower.includes("test") || baseLower.includes("spec") ||
        (parts[0] && parts[0].toLowerCase().includes("test"))) {
      testFiles++;
    }

    let text;
    try {
      text = fs.readFileSync(file, "utf8");
    } catch {
      parseErrors++;
      continue;
    }

    // Imports
    let m;
    IMPORT_RE.lastIndex = 0;
    while ((m = IMPORT_RE.exec(text)) !== null) {
      const pkg = _topLevelPackage(m[1]);
      if (pkg) imports.set(pkg, (imports.get(pkg) || 0) + 1);
    }
    REQUIRE_RE.lastIndex = 0;
    while ((m = REQUIRE_RE.exec(text)) !== null) {
      const pkg = _topLevelPackage(m[1]);
      if (pkg) imports.set(pkg, (imports.get(pkg) || 0) + 1);
    }

    // Routes
    ROUTE_RE.lastIndex = 0;
    while ((m = ROUTE_RE.exec(text)) !== null) {
      const method = m[1].toLowerCase();
      const routePath = m[2];
      if (!ROUTE_METHODS.has(method)) continue;
      // Filter out path strings that don't look like routes
      if (!routePath.startsWith("/") && !routePath.startsWith(":")) continue;
      routes.push({
        method: method.toUpperCase(),
        path: routePath,
        handler: "(inline)", // can't reliably extract handler name from regex
      });
      if (routes.length >= 200) break;
    }

    // Function/async ratio (coarse — counts occurrences, not unique decls)
    const asyncMatches = text.match(ASYNC_FN_RE);
    if (asyncMatches) asyncFunctionCount += asyncMatches.length;
    const anyMatches = text.match(ANY_FN_RE);
    if (anyMatches) totalFunctionCount += anyMatches.length;
  }

  // Frameworks
  const frameworks = new Set();
  for (const k of imports.keys()) {
    if (FRAMEWORK_MARKERS[k]) frameworks.add(FRAMEWORK_MARKERS[k]);
  }

  // Built-in Node modules — `node:`-prefixed and the legacy bare names
  const NODE_BUILTINS = new Set([
    "fs", "path", "os", "crypto", "url", "http", "https", "events",
    "stream", "util", "buffer", "child_process", "cluster", "dns", "net",
    "tls", "querystring", "readline", "repl", "string_decoder", "timers",
    "tty", "vm", "worker_threads", "zlib", "perf_hooks", "async_hooks",
    "v8", "process", "module", "assert", "console", "constants", "punycode",
    "domain", "node:fs", "node:path", "node:os", "node:crypto", "node:url",
    "node:http", "node:https", "node:events", "node:stream", "node:util",
    "node:buffer", "node:child_process", "node:cluster", "node:dns", "node:net",
    "node:tls", "node:querystring", "node:readline", "node:repl", "node:timers",
    "node:tty", "node:vm", "node:worker_threads", "node:zlib", "node:perf_hooks",
    "node:async_hooks", "node:v8", "node:process", "node:module", "node:assert",
    "node:console",
  ]);

  const thirdParty = [...imports.keys()]
    .filter((k) => !NODE_BUILTINS.has(k) && !k.startsWith("."))
    .sort()
    .slice(0, 60);

  // Stable hash so repeat startups can short-circuit
  const sigBlob = [
    thirdParty.slice().sort().join(","),
    [...frameworks].sort().join(","),
    `files=${files.length}`,
    `routes=${routes.length}`,
    `async=${asyncFunctionCount}`,
  ].join("|");
  const signatureHash = crypto.createHash("sha256")
    .update(sigBlob).digest("hex").slice(0, 16);

  // Top dirs by file count, descending
  const topDirsList = [...topDirs.entries()]
    .sort((a, b) => b[1] - a[1]).slice(0, 10).map(([d]) => d);

  return {
    language: "node",
    root_basename: path.basename(rootResolved),
    file_count: files.length,
    test_file_count: testFiles,
    parse_errors: parseErrors,
    timed_out: timedOut,
    frameworks: [...frameworks].sort(),
    third_party_deps: thirdParty,
    top_dirs: topDirsList,
    routes: routes.slice(0, 80),
    function_count: totalFunctionCount,
    async_function_count: asyncFunctionCount,
    signature_hash: signatureHash,
  };
}

function _topLevelPackage(spec) {
  if (!spec) return null;
  // Skip relative imports
  if (spec.startsWith(".") || spec.startsWith("/")) return null;
  // Skip TypeScript / Webpack / Next.js path aliases (@/foo, ~/foo, @app/foo
  // when the scope segment isn't a valid npm scope — npm scopes start with
  // a letter/digit, not / or empty).
  if (spec.startsWith("@")) {
    // Valid npm scoped package: @<scope>/<name> with scope = [a-z0-9][\w-]*
    if (!/^@[a-zA-Z0-9][\w-]*\//.test(spec)) return null;
    const parts = spec.split("/", 2);
    return parts.length === 2 ? `${parts[0]}/${parts[1]}` : null;
  }
  if (spec.startsWith("~")) return null; // Common bundler alias
  // Strip node: prefix is preserved (treated as builtin upstream)
  if (spec.startsWith("node:")) return spec;
  // Otherwise top-level segment only
  return spec.split("/", 1)[0];
}

function pushCodeSignature(client, root) {
  if (!client) return null;
  let sig;
  try {
    sig = extractCodeSignature(root);
  } catch {
    return null;
  }
  if (sig.skipped || sig.error) return null;
  try {
    client.enqueue({
      type: "custom",
      fingerprint: `code_signature:${sig.signature_hash}`,
      payload: {
        kind: "code_signature",
        name: "code_signature",
        props: sig,
      },
    });
  } catch {
    return null;
  }
  return sig.signature_hash;
}

module.exports = { extractCodeSignature, pushCodeSignature };
