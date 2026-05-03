"use strict";
/**
 * CLI tests — pure helpers, no network. Mirrors test_cli.py's
 * TestConnectHelpers + a few framework-detection cases.
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const cli = require("../cli/index.js");

let tmp;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "am-cli-"));
});

afterEach(() => {
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
});

function writePkg(deps = {}) {
  fs.writeFileSync(
    path.join(tmp, "package.json"),
    JSON.stringify({ name: "x", dependencies: deps }, null, 2)
  );
}

// ── URL/email validation ────────────────────────────────────────────

describe("looksLikeUrl", () => {
  test.each([
    "https://example.com",
    "http://example.com",
    "example.com",
    "sub.example.com",
    "https://example.com/path",
  ])("accepts %s", (s) => expect(cli.looksLikeUrl(s)).toBe(true));

  test.each(["", "notaurl", "no_dot_anywhere"])(
    "rejects %s",
    (s) => expect(cli.looksLikeUrl(s)).toBe(false)
  );
});

describe("looksLikeEmail", () => {
  test.each([
    "user@example.com",
    "name+tag@sub.domain.io",
    "x@x.co",
  ])("accepts %s", (s) => expect(cli.looksLikeEmail(s)).toBe(true));

  test.each(["", "notanemail", "missing@dot", "@nouser.com", "no@at"])(
    "rejects %s",
    (s) => expect(cli.looksLikeEmail(s)).toBe(false)
  );
});

// ── URL normalization + name derivation ─────────────────────────────

describe("normalizeUrl", () => {
  test("adds https scheme when missing", () => {
    expect(cli.normalizeUrl("example.com")).toBe("https://example.com");
  });
  test("strips trailing slash", () => {
    expect(cli.normalizeUrl("https://example.com/")).toBe("https://example.com");
  });
  test("preserves http scheme", () => {
    expect(cli.normalizeUrl("http://example.com")).toBe("http://example.com");
  });
});

describe("deriveNameFromUrl", () => {
  test("strips www / api / staging", () => {
    expect(cli.deriveNameFromUrl("https://www.acme.com")).toBe("Acme");
    expect(cli.deriveNameFromUrl("https://api.acme.com")).toBe("Acme");
    expect(cli.deriveNameFromUrl("https://staging.acme.com")).toBe("Acme");
  });
  test("capitalizes base", () => {
    expect(cli.deriveNameFromUrl("https://example.com")).toBe("Example");
  });
});

// ── DSN ─────────────────────────────────────────────────────────────

describe("buildDsn / redactDsn", () => {
  test("builds canonical https://<key>@<host>/<site_id>", () => {
    const dsn = cli.buildDsn("pk_site_abc123", "site_abc123");
    expect(dsn.startsWith("https://pk_site_abc123@")).toBe(true);
    expect(dsn.endsWith("/site_abc123")).toBe(true);
  });

  test("redactDsn hides the secret part but keeps site_id visible", () => {
    const dsn = "https://pk_yoursite_be30b3d887c0fcf3aabbccdd@api.agentminds.dev/yoursite";
    const out = cli.redactDsn(dsn);
    expect(out).not.toContain("be30b3d887c0fcf3");
    expect(out).toContain("@api.agentminds.dev/yoursite");
  });

  test("redactDsn returns input when it can't parse", () => {
    expect(cli.redactDsn("not a dsn")).toBe("not a dsn");
  });
});

// ── Framework detection ─────────────────────────────────────────────

describe("detectFramework", () => {
  test("returns null when no package.json", () => {
    expect(cli.detectFramework(tmp)).toBeNull();
  });

  test.each([
    ["express", { express: "^4.0" }],
    ["fastify", { fastify: "^4.0" }],
    ["nextjs", { next: "13.0.0" }],
    ["koa", { koa: "^2.0" }],
    ["nestjs", { "@nestjs/core": "^10.0" }],
  ])("detects %s via package.json", (expected, deps) => {
    writePkg(deps);
    expect(cli.detectFramework(tmp)).toBe(expected);
  });

  test("returns null for unknown stack", () => {
    writePkg({ lodash: "^4.0" });
    expect(cli.detectFramework(tmp)).toBeNull();
  });

  test("ignores devDependencies-only frameworks for detection? (currently picks)", () => {
    // Implementation merges deps + devDeps — assert the actual behavior so
    // a future change to make it stricter is intentional, not silent.
    fs.writeFileSync(
      path.join(tmp, "package.json"),
      JSON.stringify({ devDependencies: { express: "^4.0" } })
    );
    expect(cli.detectFramework(tmp)).toBe("express");
  });
});

// ── Entry-file detection ────────────────────────────────────────────

describe("detectEntryFile", () => {
  test("finds Express instantiation in src/server.js", () => {
    fs.mkdirSync(path.join(tmp, "src"));
    fs.writeFileSync(
      path.join(tmp, "src/server.js"),
      'const express = require("express");\nconst app = express();\n'
    );
    const found = cli.detectEntryFile(tmp, "express");
    expect(found).toBe(path.join(tmp, "src/server.js"));
  });

  test("returns null when no entry matches", () => {
    expect(cli.detectEntryFile(tmp, "express")).toBeNull();
  });
});

// ── Arg parsing ─────────────────────────────────────────────────────

describe("parseArgs", () => {
  test("--flag=value form", () => {
    expect(cli.parseArgs(["--url=https://x.com"])).toEqual({ _: [], url: "https://x.com" });
  });
  test("--flag value form", () => {
    expect(cli.parseArgs(["--url", "https://x.com"])).toEqual({ _: [], url: "https://x.com" });
  });
  test("boolean --flag with no value", () => {
    expect(cli.parseArgs(["--no-apply"])).toEqual({ _: [], "no-apply": true });
  });
  test("collects positional args", () => {
    expect(cli.parseArgs(["foo", "--x=1", "bar"])).toEqual({ _: ["foo", "bar"], x: "1" });
  });
});
