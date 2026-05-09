# @agentmindsdev/node

[![npm version](https://img.shields.io/npm/v/@agentmindsdev/node.svg)](https://www.npmjs.com/package/@agentmindsdev/node)
[![Node](https://img.shields.io/node/v/@agentmindsdev/node.svg)](https://www.npmjs.com/package/@agentmindsdev/node)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![ARP 1.3.0](https://img.shields.io/badge/ARP-1.3.0-blue)](https://github.com/agentmindsdev/profile)
[![MCP-aware](https://img.shields.io/badge/MCP-extensions--wg-green)](https://modelcontextprotocol.io)

> **AgentMinds is a cross-site collective intelligence pool for production
> AI agents.** Every connected site pushes what its agents observed +
> learned; every site pulls back the patterns its specific stack needs
> — solved fixes from peer sites, network benchmarks, ranked rules.
> One npm install, one push, you're in the pool.

> **v0.4.0** (2026-05-08): ARP 1.3.0 alignment —
> `top_production_observed` + `top_documented` split arrays (B1),
> `negative_evidence` array consumption (A3), `reversibility`
> field passthrough (B2). See [CHANGELOG.md](CHANGELOG.md).

## How AgentMinds works (3 tiers)

The Node SDK supports all three tiers exposed by the AgentMinds
backend. Anonymous trial requires no configuration; registered
and personalised need an API key from
[agentminds.dev/onboard](https://agentminds.dev/onboard) (or via
`npx @agentmindsdev/node connect`).

| Mode | Patterns / day | What you give | What you get |
|---|---|---|---|
| **Anonymous trial** | 3 popular | nothing | Top relevance-scored patterns from the public pool |
| **Registered (no push)** | 10 rotational | URL + name | Daily-rotated slice of the top-50 pool, seeded by `site_id` |
| **Personalised** | unlimited | agent reports | Stack-matched recommendations, cross-site references, negative evidence |

This SDK does two things:

1. **Auto-capture** uncaught exceptions, 5xx responses, and ERROR logs
   from your Node.js app — Sentry-style ergonomics, zero deps.
2. **Sync API client** for pushing agent reports + pulling personalised
   recommendations, benchmarks, issues, and patterns from the
   network pool.

## 60-second start

```bash
npm install @agentmindsdev/node
```

```js
const agentminds = require("@agentmindsdev/node");

// A) Runtime exception capture — drop-in Sentry replacement
agentminds.init({ dsn: "https://pk_yoursite_xxx@api.agentminds.dev/yoursite" });

// B) Push an agent's report to the network
await agentminds.sync.report({
  apiKey: "sk_yoursite_xxx",
  siteId: "yoursite",
  agent: "security",
  metrics: { hsts_present: 1, csp_present: 1, ssl_days_remaining: 60 },
  learnedPatterns: [{
    pattern: "csp_breaks_inline_react",
    category: "security",
    confidence: 0.9,
    status: "solved",
    impact: "high",
    detail: "Strict CSP broke inline React event handlers; added nonce",
  }],
});

// C) Pull what the network has solved for sites like yours
const recs   = await agentminds.sync.recommendations({ apiKey: "sk_..." });
const bench  = await agentminds.sync.benchmarks({ apiKey: "sk_...", siteId: "yoursite" });
const role   = await agentminds.sync.myRole({ apiKey: "sk_..." });
const issues = await agentminds.sync.issues({ apiKey: "sk_..." });
```

Get an API key (and a free baseline scan) by running the interactive
onboarder once:

```bash
npx @agentmindsdev/node connect
```

---

## Why this exists (and why "another Sentry" misses the point)

Sentry tells you **your** error fingerprint. We do that too — but the
real value-add is cross-site context. When `EmailValidatorError` fires
on your site, we tell you:

- 14 sites in the pool have hit this exact fingerprint
- 9 of them solved it with the same one-line patch
- Your stack (Express + Joi + email-validator 2.x) matches 7/9
- Confidence the patch will work for you: **0.78**

> *Numbers in this example (14 / 9 / 0.78) are illustrative.*
> *Actual peer counts vary by pattern fingerprint and current*
> *network state. The pool today has 6 active contributing sites*
> *and 2,970 production-observed patterns — see live numbers at*
> *[/sync/pool-stats](https://api.agentminds.dev/api/v1/sync/pool-stats).*

That cross-site lift is the moat — it doesn't exist in any single-tenant
APM. The runtime SDK shipping crashes is the on-ramp; the `sync.*`
surface is what keeps you here.

See [CORE_PURPOSE.md](https://github.com/agentmindsdev/profile/blob/main/CORE_PURPOSE.md)
for the full architectural rationale.

---

## Runtime auto-capture (Sentry-compatible API)

After `init()`:

- `process.on('uncaughtException')` — every uncaught throw shipped + flushed.
- `process.on('unhandledRejection')` — every dangling promise captured.
- The SDK is a no-op if no DSN is set — safe to leave `init()` in dev.

### Express

```js
const express = require("express");
const agentminds = require("@agentmindsdev/node");
const { requestHandler, errorHandler } = require("@agentmindsdev/node/integrations/express");

agentminds.init({ dsn: process.env.AGENTMINDS_DSN });

const app = express();
app.use(requestHandler());        // BEFORE routes — opens per-request scope
// ... your routes ...
app.use(errorHandler());          // AFTER routes — last middleware
```

`requestHandler` opens an `AsyncLocalStorage` scope per request so
`setUser` / `setTag` / `addBreadcrumb` are isolated to that request.

### Fastify

```js
const fastify = require("fastify")();
const agentminds = require("@agentmindsdev/node");

agentminds.init({ dsn: process.env.AGENTMINDS_DSN });
fastify.register(require("@agentmindsdev/node/integrations/fastify"));
```

### Next.js (App Router, 13.4+)

`instrumentation.ts`:

```ts
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const agentminds = await import("@agentmindsdev/node");
    agentminds.init({ dsn: process.env.AGENTMINDS_DSN });
  }
}
```

Wrap individual route handlers:

```ts
import { wrapRouteHandler } from "@agentmindsdev/node/integrations/nextjs";

export const GET = wrapRouteHandler(async (req) => {
  return Response.json({ ok: true });
});
```

### Manual capture

```js
try {
  await riskyThing();
} catch (e) {
  agentminds.captureException(e);
}

agentminds.captureMessage("payment retry exceeded", "warn");
agentminds.setUser({ id: user.id, email: user.email });
agentminds.setTag("plan", user.plan);
agentminds.addBreadcrumb({ category: "db", message: "SELECT ..." });
```

---

## Sync API surface — push + pull

All `sync.*` calls take an `apiKey` (or read `process.env.AGENTMINDS_API_KEY`),
return parsed JSON via promise, and throw `AgentMindsAPIError` on 4xx/5xx.
Zero extra deps beyond what `init()` already needs.

### Push: report what your agent observed + learned

```js
await agentminds.sync.report({
  agent: "security",
  siteId: "yoursite",                    // or AGENTMINDS_SITE_ID
  apiKey: "sk_yoursite_xxx",             // or AGENTMINDS_API_KEY
  severity: "warning",
  summary: "HSTS missing; 2 mixed-content URLs on /pricing",
  metrics: {
    hsts_present: 0,
    csp_present: 1,
    x_frame_options_present: 1,
    ssl_days_remaining: 60,
    mixed_content_count: 2,
  },
  warnings: [
    { severity: "warning", message: "HSTS header not set" },
    { severity: "info",    message: "2 mixed-content resources" },
  ],
  learnedPatterns: [{
    pattern: "fresh_site_baseline_security",
    category: "security",
    confidence: 0.9,
    status: "active",
    impact: "medium",
    detail: "Default Render tier headers; needs HSTS pin",
  }],
  projectInfo: {
    tech_stack: { framework: "Express", database: "PostgreSQL", frontend: "Next.js" },
  },
});
```

Server validates against the [AgentMinds Reporting Profile (ARP)
v1.1](https://github.com/agentmindsdev/profile) and returns a
data-quality grade (A–F). Grade D+ enters the pool.

### Pull: what the network knows about your stack

```js
const me       = await agentminds.sync.me({ apiKey });
const recs     = await agentminds.sync.recommendations({ apiKey, limit: 10 });
const bench    = await agentminds.sync.benchmarks({ apiKey, siteId });
const role     = await agentminds.sync.myRole({ apiKey });
const pos      = await agentminds.sync.networkPosition({ apiKey });
const issues   = await agentminds.sync.issues({ apiKey, status: "open" });
const actions  = await agentminds.sync.actions({ apiKey, status: "pending" });
const patterns = await agentminds.sync.patterns({ apiKey, category: "security" });
```

Each call is auth-scoped to your site. Cross-site `learnedPatterns`
are not browseable — they're personalised to your stack and ranked.

---

## Logger integrations

### Winston

```js
const winston = require("winston");
const { WinstonTransport } = require("@agentmindsdev/node/integrations/logger");

const logger = winston.createLogger({
  transports: [
    new winston.transports.Console(),
    new WinstonTransport({ level: "warn" }),
  ],
});
```

### Pino

```js
const pino = require("pino");
const { pinoStream } = require("@agentmindsdev/node/integrations/logger");

const logger = pino({ level: "info" }, pinoStream());
```

---

## Configuration

| Option | Env var | Default | Notes |
|---|---|---|---|
| `dsn` | `AGENTMINDS_DSN` | — | Required for runtime capture. |
| `apiKey` | `AGENTMINDS_API_KEY` | — | Required for `sync.*`. |
| `siteId` | `AGENTMINDS_SITE_ID` | — | Required for `sync.report` / `sync.benchmarks`. |
| `apiUrl` | `AGENTMINDS_API` | `https://api.agentminds.dev` | Override for staging. |
| `release` | `AGENTMINDS_RELEASE` | `git rev-parse --short HEAD` | Tag events with build. |
| `environment` | `AGENTMINDS_ENV` | `"production"` | Filter on the dashboard. |
| `sampleRate` | — | `1.0` | `0.1` = drop 90% of runtime events. |
| `debug` | `AGENTMINDS_DEBUG=1` | `false` | Log internals to console. |
| `installExceptionHooks` | — | `true` | Hook process error events. |

---

## Privacy

- No request bodies, no DB query parameters captured.
- User PII only sent via explicit `setUser({...})` calls.
- Stack traces truncated to 8 KB; messages to 500 chars.
- Cross-site `learnedPatterns` are private to the network pool — never
  exposed via no-auth API. Per-site personalised delivery only.

---

## Honest status

This is early-stage. The pool has **6 active contributing sites**
and **2,970 production-observed patterns** as of this writing.
Cross-site "peer sites solving the same problem" recommendations
activate as the network grows; for now the SDK serves top
patterns from the pool plus rotational picks for registered
users.

We're inside the first 100-founder window — **94 lifetime-free
slots remaining**. Sites that connect during this window keep
the founder tier (all features, free, forever). Live numbers at
[/sync/pool-stats](https://api.agentminds.dev/api/v1/sync/pool-stats).

If you're evaluating this for your team, the
[**ARP spec**](https://github.com/agentmindsdev/profile) is the
most mature surface (formally versioned at v1.3.0 with extension
points and a [reorientation clause](https://github.com/agentmindsdev/profile#reorientation-clause)).
The SDK is v0.4.x — actively iterated. Bug reports welcome.

---

## Links

- **Homepage**: <https://agentminds.dev>
- **Dashboard**: <https://agentminds.dev/dashboard>
- **Docs**: <https://agentminds.dev/docs/node>
- **Spec (ARP 1.3.0)**: <https://github.com/agentmindsdev/profile>
- **Python SDK**: [`agentminds`](https://pypi.org/project/agentminds/)
- **npm**: <https://www.npmjs.com/package/@agentmindsdev/node>
- **Issues**: <https://github.com/agentmindsdev/node-sdk/issues>

## License

MIT
