# Changelog

All notable changes to `@agentmindsdev/node` are documented here.

## [Unreleased]

## [0.4.0] — 2026-05-08

Minor release. Backwards compatible.

### Added
- **`agentminds.sync` module** — high-level helpers for the
  AgentMinds `/sync` API surface so integrators never hand-roll JSON
  payloads or manage the `X-AgentMinds-Key` header by hand.
  - **Push (your data → AgentMinds):** `sync.report({ apiKey,
    siteId, agent, metrics, warnings, learnedPatterns, projectInfo })`
    posts a structured agent report to `/api/v1/sync/bulk`.
  - **Pull (AgentMinds insights → your code):**
    `sync.recommendations({ apiKey, limit })`,
    `sync.benchmarks({ apiKey, siteId })`,
    `sync.myRole({ apiKey })`, plus network-position + issues
    helpers. All return parsed JSON; no manual fetch / header
    plumbing.
- **`agentminds.metrics` module** — canonical metric emitters that
  mirror the server-side registry. Lets a Node app push metrics by
  the same names the central pool uses (e.g. `hsts_present`,
  `ssl_days_remaining`, `bounce_rate`) without hand-coding the
  schema. Avoids the "your push got grade-D because metric names
  didn't match" failure mode.

### Changed
- README rewritten around the **cross-site collective intelligence**
  positioning: the SDK pushes runtime events + agent reports into a
  shared pool and pulls personalized recommendations back. Install
  steps unchanged; the framing leads with the network value rather
  than the captured-events value.
- `package.json` metadata aligned with the public spec repo
  (`homepage`, `repository`, `bugs`) and the company-wide ARP spec
  reference. `keywords` extended for collective-intelligence /
  ai-agents discoverability on npm.

### Compatibility
- Compatible with AgentMinds backend `a8c23b3+` (tier-aware
  shaping: `/sync/trial-rules`, `/sync/personalized-rules`).
- Compatible with `agentminds-mcp 1.3.0+`.
- Implements the response-shape contract published in
  [ARP spec v1.3.0](https://github.com/agentmindsdev/profile)
  (`top_production_observed` + `top_documented` split arrays,
  `negative_evidence`, optional `reversibility` field — passed
  through unchanged from server response, no client-side parsing
  required).

### Internal
- Test suite at 84 tests (Jest), all passing.
- 0 Turkish characters in `.js` / `.ts` / `.json` / `.md` source
  files (English-only contract aligned with the company-wide
  user-facing strings rule).
- npm pack dry-run: 26.2 kB tarball, 16 files.

## [0.3.0] — 2026-04-26

### Added
- **`agentminds-connect` — one-command onboarding.** New CLI bin
  (registered in `package.json` so `npx @agentmindsdev/node connect`
  works). Mirrors the Python SDK's `agentminds connect`:
  1. Prompts for site URL + email (or accepts `--url` / `--email`).
  2. POSTs to `/api/v1/sync/onboard`.
  3. Builds the DSN from the returned `api_key` + `site_id`.
  4. Detects framework (express / fastify / nextjs / koa / nestjs)
     via `package.json` deps and prints framework-specific install
     steps + env-var instructions.
- 38 new jest tests for the CLI's pure helpers (URL/email validation,
  URL normalization, name derivation, DSN format, framework
  detection, entry-file discovery, arg parsing). Total now 84 tests.
- `AGENTMINDS_API` env var override-able for self-hosted setups + tests.

### Why
- The Node README previously pointed users at the Python CLI as the
  fastest onboarding even for Node apps — that's no longer the case.
  `npx @agentmindsdev/node connect` is the recommended path now.

### Notes
- Auto-apply (in-place file editing) is intentionally NOT implemented
  for Node v1: TS imports + ESM/CJS mix + bundler configs make safe
  splicing noisier than Python's. The CLI prints the exact lines to
  add and where; auto-apply is roadmap.

## [0.2.0] — 2026-04-26

### Added
- **Code introspection at init time.** Mirror of the Python SDK 0.2.0+
  feature. `agentminds.init({ dsn })` now walks the host app's source
  tree once at startup and ships a structured "code signature" so
  AgentMinds knows what frameworks / routes / deps it's monitoring
  without any follow-up step. Same DSN, full picture.

### What gets shipped (single `custom` event with `kind=code_signature`)
- Detected web frameworks (express, fastify, koa, hapi, nestjs, next,
  react, vue, angular, svelte) + DB / cache (postgres, mysql, mongodb,
  redis, prisma) + cloud (aws, stripe) + LLM (anthropic, openai)
- HTTP routes via regex match on `app.get('/path')`, `router.post('/path')`,
  etc. — method + path captured. (Decorator-based or file-based routes
  like Next.js App Router are not regex-extractable; that's expected.)
- Top-level package layout (depth ≤ 6, file count ≤ 800)
- Third-party deps from `import`/`require` calls; built-ins (`fs`,
  `node:path`, …) filtered; TS/Webpack/Next path aliases (`@/foo`,
  `~/foo`) filtered.
- Async-arrow vs total function ratio (regex-coarse but useful for
  perf sniffing)
- Test file count (anything with "test" or "spec" in name/path)
- Stable `signature_hash` so repeat startups can short-circuit.

### Privacy / safety
- Function bodies, comments, JSDoc, and string literals (other than
  detected route paths and import specs) are NEVER sent — only
  structural facts.
- Walk skips `node_modules`, `dist`, `.next`, `build`, `coverage`,
  `.cache`, `.turbo`, `.git`, vendor dirs.
- Hard caps: 800 files, 200 KB/file, depth 6, total scan budget 5 s
  (deadline enforced; result tagged `timed_out: true` if it trips).
- Best-effort: introspection failure is non-fatal to init.
- Disable via `init({ introspectCode: false })` or override the scan
  root via `init({ projectRoot: "/path" })`.

### New init options
| Option | Default | Notes |
|---|---|---|
| `introspectCode` | `true` | Set `false` to skip code-signature shipping |
| `projectRoot` | `process.cwd()` | Override the directory we walk |

### No API breakage
- Existing init signature unchanged; new options are additive.
- Same wire format — code signatures share the `runtime_events`
  table with errors / Web Vitals / 5xx.

## [0.1.0] — 2026-04-26

Initial public release.

### Added
- `agentminds.init({ dsn })` — single entry point. Idempotent; no-op without DSN.
- Auto-capture for `process.on('uncaughtException')` and `process.on('unhandledRejection')`.
- Manual capture API — `captureException`, `captureMessage`, `captureEvent`.
- Scope API — `setUser`, `setTag`, `setExtra`, `setTransaction`, `addBreadcrumb`, `clearScope`. Backed by `AsyncLocalStorage` so concurrent requests don't bleed state.
- Express integration — `requestHandler()` + `errorHandler()` from `@agentmindsdev/node/integrations/express`. `requestHandler` opens an ALS scope per request; `errorHandler` is a 4-arg Express error middleware that captures and re-throws.
- Fastify plugin — `@agentmindsdev/node/integrations/fastify` registers `onRequest` / `onError` / `onResponse` hooks.
- Next.js helper — `wrapRouteHandler` from `@agentmindsdev/node/integrations/nextjs` for App Router 13.4+ route handlers; pairs with `instrumentation.ts` for process-wide init.
- Logger transports — `WinstonTransport` (winston) + `pinoStream` (pino) + `wrapConsoleError()` from `@agentmindsdev/node/integrations/logger`.
- Release auto-detection from `git rev-parse --short HEAD`.
- Bounded in-memory queue (1000 events, drop-oldest under back-pressure) flushed every 5s or when queue ≥ 30.
- `process.once('exit')` and `process.once('beforeExit')` final-flush hooks.

### Wire format
- Posts batched events to `POST {api_base}/api/v1/sync/ingest/{site_id}/events?key={public_key}` with body `{ "events": [...] }`. Identical envelope as the browser collector (`agent.js`) and the Python SDK — all three land in the same `runtime_events` table.

### Engines
- Node `>= 14.17` (uses `AsyncLocalStorage`).

### Privacy defaults
- `sendDefaultPii=false` — no request bodies, no DB query parameters captured.
- Stack traces truncated to 8 KB; messages to 500 chars.
- User PII only sent via explicit `setUser({...})` calls.
