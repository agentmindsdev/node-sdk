#!/usr/bin/env node
"use strict";
/**
 * @agentmindsdev/node CLI — `agentminds-connect` is the one-command
 * onboarding for Node apps. Mirrors the Python SDK's `agentminds connect`
 * so users get the same flow regardless of host language.
 *
 * Usage:
 *   npx @agentmindsdev/node connect [--url=...] [--email=...] [--name=...] [--root=PATH] [--no-apply]
 *   npx @agentmindsdev/node version
 *
 * Zero runtime deps — uses node:https + node:readline + a minimal arg parser.
 */

const fs = require("node:fs");
const https = require("node:https");
const http = require("node:http");
const path = require("node:path");
const readline = require("node:readline");
const { URL } = require("node:url");

const pkg = require("../package.json");

// ── ANSI helpers ────────────────────────────────────────────────────────

const USE_COLOR = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (code, text) => (USE_COLOR ? `\x1b[${code}m${text}\x1b[0m` : text);
const bold = (t) => c("1", t);
const green = (t) => c("32", t);
const yellow = (t) => c("33", t);
const blue = (t) => c("34", t);
const dim = (t) => c("2", t);

// Some Windows consoles can't encode → … ✓ — fall back to ASCII when
// the codepage looks suspicious. Node sets PYTHONIOENCODING-equivalent
// behavior via process.stdout.write directly so we test by encoding probe.
function _canEncodeUnicode() {
  // Node's stdout uses utf8 by default on every platform — but Windows
  // legacy consoles (cp1254/cp1252) reflect via the codepage env, not the
  // stream encoding. Probe via WriteStream.encoding when present, default
  // to true on POSIX.
  if (process.platform !== "win32") return true;
  const codepage = process.env.OutputEncoding || process.env.OEMCP || "";
  // If cp1252/1254/etc, fall back. PowerShell 7+ defaults to UTF-8.
  return /utf|65001/i.test(codepage);
}
const UNICODE_OK = _canEncodeUnicode();
const ARROW = UNICODE_OK ? "→" : "->";
const ELLIPSIS = UNICODE_OK ? "…" : "...";
const CHECK = UNICODE_OK ? "✓" : "[ok]";

// ── Framework detection (Node ecosystem) ────────────────────────────────

const FRAMEWORK_DEPS = {
  express: ["express"],
  fastify: ["fastify"],
  nextjs: ["next"],
  koa: ["koa"],
  nestjs: ["@nestjs/core"],
};

function detectFramework(root) {
  const pkgPath = path.join(root, "package.json");
  if (!fs.existsSync(pkgPath)) return null;
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  } catch {
    return null;
  }
  const all = { ...(parsed.dependencies || {}), ...(parsed.devDependencies || {}) };
  for (const [name, marks] of Object.entries(FRAMEWORK_DEPS)) {
    if (marks.some((m) => all[m])) return name;
  }
  return null;
}

// ── Entry-file detection ────────────────────────────────────────────────

const ENTRY_CANDIDATES = [
  "src/server.js", "src/server.ts",
  "src/index.js", "src/index.ts",
  "src/app.js", "src/app.ts",
  "server.js", "server.ts",
  "index.js", "index.ts",
  "app.js", "app.ts",
];

const EXPRESS_INST_RE = /(\w+)\s*=\s*express\s*\(/;
const FASTIFY_INST_RE = /(\w+)\s*=\s*(?:fastify|require\(['"]fastify['"]\))\s*\(/;

function detectEntryFile(root, framework) {
  const re = framework === "express" ? EXPRESS_INST_RE
    : framework === "fastify" ? FASTIFY_INST_RE
    : null;
  if (!re) return null;
  for (const rel of ENTRY_CANDIDATES) {
    const full = path.join(root, rel);
    if (fs.existsSync(full)) {
      try {
        const text = fs.readFileSync(full, "utf8");
        if (re.test(text)) return full;
      } catch { /* keep walking */ }
    }
  }
  return null;
}

// ── Snippet printing ────────────────────────────────────────────────────

function printExpressSteps(entry, root) {
  const rel = entry ? path.relative(root, entry) : "your Express entry file";
  console.log(bold(`Express install — 3 edits in ${rel}:`));
  console.log();
  console.log(blue("1)  At the TOP of the file (above any express() call):"));
  console.log('    const agentminds = require("@agentmindsdev/node");');
  console.log('    const { requestHandler, errorHandler } = require("@agentmindsdev/node/integrations/express");');
  console.log();
  console.log('    agentminds.init({ dsn: process.env.AGENTMINDS_DSN });');
  console.log();
  console.log(blue("2)  Right BEFORE your routes:"));
  console.log("    app.use(requestHandler());");
  console.log();
  console.log(blue("3)  Right AFTER your routes (last middleware):"));
  console.log("    app.use(errorHandler());");
  console.log();
  console.log(blue("4)  Add to package.json dependencies:"));
  console.log(`    "@agentmindsdev/node": "^${pkg.version}"`);
}

function printFastifySteps(entry, root) {
  const rel = entry ? path.relative(root, entry) : "your Fastify entry file";
  console.log(bold(`Fastify install — 2 edits in ${rel}:`));
  console.log();
  console.log(blue("1)  At the TOP of the file:"));
  console.log('    const agentminds = require("@agentmindsdev/node");');
  console.log('    const fastifyAgentMinds = require("@agentmindsdev/node/integrations/fastify");');
  console.log('    agentminds.init({ dsn: process.env.AGENTMINDS_DSN });');
  console.log();
  console.log(blue("2)  Register the plugin after fastify():"));
  console.log("    fastify.register(fastifyAgentMinds);");
  console.log();
  console.log(blue("3)  Add to package.json dependencies:"));
  console.log(`    "@agentmindsdev/node": "^${pkg.version}"`);
}

function printNextjsSteps() {
  console.log(bold("Next.js install:"));
  console.log();
  console.log(blue("1)  Create instrumentation.ts at your project root:"));
  console.log();
  console.log('    export async function register() {');
  console.log('      if (process.env.NEXT_RUNTIME === "nodejs") {');
  console.log('        const agentminds = await import("@agentmindsdev/node");');
  console.log('        agentminds.init({ dsn: process.env.AGENTMINDS_DSN });');
  console.log('      }');
  console.log('    }');
  console.log();
  console.log(blue("2)  Enable in next.config.js:"));
  console.log("    module.exports = { experimental: { instrumentationHook: true } };");
  console.log();
  console.log(blue("3)  Add to package.json dependencies:"));
  console.log(`    "@agentmindsdev/node": "^${pkg.version}"`);
}

function printGenericSteps() {
  console.log(bold("Generic Node install:"));
  console.log();
  console.log(blue("1)  In your app's startup module:"));
  console.log('    const agentminds = require("@agentmindsdev/node");');
  console.log('    agentminds.init({ dsn: process.env.AGENTMINDS_DSN });');
  console.log();
  console.log(blue("2)  Add to package.json dependencies:"));
  console.log(`    "@agentmindsdev/node": "^${pkg.version}"`);
}

function printEnvVar(dsn) {
  console.log();
  console.log(bold("Add to your runtime environment (DON'T commit):"));
  console.log(`  ${blue("AGENTMINDS_DSN")}=${dsn}`);
}

// ── Onboarding API call ─────────────────────────────────────────────────

const ONBOARD_API = (process.env.AGENTMINDS_API || "https://api.agentminds.dev").replace(/\/+$/, "");
const ONBOARD_PATH = "/api/v1/sync/onboard";

function postOnboard(siteUrl, name, email) {
  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(ONBOARD_API + ONBOARD_PATH);
    } catch (e) {
      reject(new Error(`Bad AGENTMINDS_API: ${ONBOARD_API}`));
      return;
    }
    const body = JSON.stringify({ url: siteUrl, name, email });
    const lib = parsed.protocol === "http:" ? http : https;
    const req = lib.request(
      {
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === "http:" ? 80 : 443),
        path: parsed.pathname,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
        timeout: 30_000,
      },
      (res) => {
        let chunks = "";
        res.setEncoding("utf8");
        res.on("data", (d) => (chunks += d));
        res.on("end", () => {
          let payload;
          try { payload = JSON.parse(chunks); } catch { payload = { raw: chunks }; }
          if (res.statusCode >= 200 && res.statusCode < 300) resolve(payload);
          else reject(new Error(`onboard ${res.statusCode}: ${payload.detail || payload.message || JSON.stringify(payload)}`));
        });
      }
    );
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("onboard request timed out")));
    req.write(body);
    req.end();
  });
}

function buildDsn(apiKey, siteId) {
  const parsed = new URL(ONBOARD_API);
  return `https://${apiKey}@${parsed.host}/${siteId}`;
}

function redactDsn(dsn) {
  const m = dsn.match(/^(https:\/\/)([^@]+)(@.*)$/);
  if (!m) return dsn;
  const user = m[2];
  const redacted = user.length > 16 ? `${user.slice(0, 8)}${ELLIPSIS}${user.slice(-4)}` : ELLIPSIS;
  return `${m[1]}${redacted}${m[3]}`;
}

// ── Validation helpers ──────────────────────────────────────────────────

function looksLikeUrl(s) {
  if (!s) return false;
  try {
    const u = new URL(/:\/\//.test(s) ? s : `https://${s}`);
    return !!u.hostname && u.hostname.includes(".");
  } catch {
    return false;
  }
}

function looksLikeEmail(s) {
  return typeof s === "string" && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s);
}

function normalizeUrl(s) {
  let v = s;
  if (!/:\/\//.test(v)) v = `https://${v}`;
  return v.replace(/\/+$/, "");
}

function deriveNameFromUrl(siteUrl) {
  const u = new URL(siteUrl);
  const stripped = u.hostname
    .split(".")
    .filter((p) => !["www", "app", "api", "staging", "dev"].includes(p));
  const base = stripped.length ? stripped[0] : u.hostname;
  return base.charAt(0).toUpperCase() + base.slice(1);
}

// ── Interactive prompt ──────────────────────────────────────────────────

function prompt(rl, label, opts = {}) {
  const { defaultValue = "", required = false } = opts;
  const suffix = defaultValue ? ` [${defaultValue}]` : "";
  return new Promise((resolve, reject) => {
    rl.question(`${label}${suffix}: `, (raw) => {
      const value = (raw || "").trim();
      if (!value && defaultValue) return resolve(defaultValue);
      if (!value && required) {
        console.log(yellow(`  ${label} is required.`));
        return prompt(rl, label, opts).then(resolve, reject);
      }
      resolve(value);
    });
  });
}

// ── Arg parsing (minimal — handles --flag=value and --flag value) ──────

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      if (eq !== -1) {
        out[a.slice(2, eq)] = a.slice(eq + 1);
      } else {
        const next = argv[i + 1];
        if (next && !next.startsWith("--")) {
          out[a.slice(2)] = next;
          i++;
        } else {
          out[a.slice(2)] = true;
        }
      }
    } else {
      out._.push(a);
    }
  }
  return out;
}

// ── Connect command ─────────────────────────────────────────────────────

async function cmdConnect(args) {
  const root = path.resolve(args.root || process.cwd());
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    console.error(`error: ${root} is not a directory`);
    return 2;
  }

  console.log();
  console.log(bold("agentminds connect"));
  console.log(dim(`  scanning: ${root}`));

  const isTty = process.stdin.isTTY;
  const rl = isTty
    ? readline.createInterface({ input: process.stdin, output: process.stdout })
    : null;

  let url = (args.url || "").trim();
  let email = (args.email || "").trim();
  let name = (args.name || "").trim();

  try {
    if (!url) {
      if (!isTty) {
        console.log(yellow("--url is required when running non-interactively."));
        return 2;
      }
      url = await prompt(rl, "Site URL (e.g. yourapp.com)", { required: true });
    }
    if (!looksLikeUrl(url)) {
      console.log(yellow(`That doesn't look like a URL: ${JSON.stringify(url)}`));
      return 2;
    }
    url = normalizeUrl(url);

    if (!email) {
      if (!isTty) {
        console.log(yellow("--email is required when running non-interactively."));
        return 2;
      }
      email = await prompt(rl, "Email (so we can recover your key)", { required: true });
    }
    if (!looksLikeEmail(email)) {
      console.log(yellow(`That doesn't look like an email: ${JSON.stringify(email)}`));
      return 2;
    }

    if (!name) {
      const guess = deriveNameFromUrl(url);
      name = isTty ? await prompt(rl, "Site name", { defaultValue: guess }) : guess;
    }
  } finally {
    if (rl) rl.close();
  }

  console.log();
  console.log(`  url:   ${green(url)}`);
  console.log(`  email: ${green(email)}`);
  console.log(`  name:  ${green(name)}`);
  console.log();

  console.log(dim(`${ARROW} registering with ${ONBOARD_API} ...`));

  let result;
  try {
    result = await postOnboard(url, name, email);
  } catch (e) {
    console.log();
    console.log(yellow(`Registration failed: ${e.message}`));
    console.log(dim("If you already registered this site, recover the key at https://agentminds.dev/onboard"));
    return 1;
  }

  const apiKey = result.api_key;
  const siteId = result.site_id;
  if (!apiKey || !siteId) {
    console.log(yellow(`Unexpected response from server: ${JSON.stringify(result)}`));
    return 1;
  }

  const dsn = buildDsn(apiKey, siteId);
  console.log(green(`${CHECK} registered`));
  console.log(`  site_id: ${green(siteId)}`);
  console.log(`  dsn:     ${green(redactDsn(dsn))}`);

  if (result.first_scan) {
    const fs_ = result.first_scan;
    const grade = fs_.grade || "?";
    const issues = fs_.issue_count;
    const bits = [`grade ${grade}`];
    if (issues != null) bits.push(`${issues} surface issue(s)`);
    console.log(`  first scan: ${dim(bits.join(", "))}`);
  }

  console.log();

  const framework = detectFramework(root);
  if (!framework) {
    console.log(yellow("Could not auto-detect a Node framework in this directory."));
    console.log(dim("If your project lives elsewhere, re-run with --root=/path/to/your-app"));
    console.log(dim("Otherwise, here's how to wire it up manually:"));
    printGenericSteps();
    printEnvVar(dsn);
    return 0;
  }

  console.log(`  framework: ${green(framework)}`);
  const entry = detectEntryFile(root, framework);
  if (entry) {
    console.log(`  entry file: ${green(path.relative(root, entry))}`);
  } else {
    console.log(`  entry file: ${yellow("not auto-detected")}`);
  }
  console.log();

  if (framework === "express") printExpressSteps(entry, root);
  else if (framework === "fastify") printFastifySteps(entry, root);
  else if (framework === "nextjs") printNextjsSteps();
  else printGenericSteps();

  // NOTE: Auto-apply for Node is intentionally out of scope here — the
  // splice patterns are noisier than Python's (TS imports, ESM/CJS mix,
  // bundler configs). v1 prints the steps; auto-apply is roadmap.

  printEnvVar(dsn);
  console.log(bold("Next:"));
  console.log("  1) Set the env var above in your runtime (Render / Vercel / Docker / .env).");
  console.log("  2) Deploy — your site is now sending reports to the network.");
  console.log(`  3) Visit https://agentminds.dev/dashboard?site=${siteId} to see your data.`);
  console.log();
  return 0;
}

// ── Entry point ─────────────────────────────────────────────────────────

async function main(argv) {
  const sub = argv[0];
  const rest = argv.slice(1);

  if (!sub || sub === "--help" || sub === "-h") {
    console.log("usage: agentminds-connect <connect|version>");
    console.log();
    console.log("  connect [--url=...] [--email=...] [--name=...] [--root=PATH] [--no-apply]");
    console.log("    Register this site + print SDK install steps for Node frameworks.");
    console.log();
    console.log("  version");
    console.log("    Print SDK version.");
    return 0;
  }

  if (sub === "version" || sub === "--version") {
    console.log(pkg.version);
    return 0;
  }

  if (sub === "connect") {
    return cmdConnect(parseArgs(rest));
  }

  console.error(`unknown command: ${sub}`);
  return 64;
}

if (require.main === module) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      console.error(err && err.stack ? err.stack : err);
      process.exit(1);
    }
  );
}

module.exports = {
  // exposed for tests
  detectFramework,
  detectEntryFile,
  looksLikeUrl,
  looksLikeEmail,
  normalizeUrl,
  deriveNameFromUrl,
  buildDsn,
  redactDsn,
  parseArgs,
};
