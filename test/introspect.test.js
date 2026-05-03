"use strict";
/**
 * Code introspection tests — symmetric to test_introspect.py.
 *
 * Each test creates a small synthetic project under os.tmpdir(),
 * runs extractCodeSignature on it, and asserts on the structured
 * output. We use Node's built-in fs/os/path so the tests have no
 * extra deps beyond jest itself.
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { extractCodeSignature } = require("../src/introspect");

let tmp;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "am-test-"));
});

afterEach(() => {
  try {
    fs.rmSync(tmp, { recursive: true, force: true });
  } catch {
    // Best-effort cleanup; OS will reclaim
  }
});

function write(rel, body) {
  const full = path.join(tmp, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, body, "utf8");
}

// ── Empty / invalid roots ────────────────────────────────────────────

describe("extractCodeSignature — empty / invalid roots", () => {
  test("empty directory returns skipped", () => {
    const sig = extractCodeSignature(tmp);
    expect(sig.language).toBe("node");
    expect(sig.file_count).toBe(0);
    expect(sig.skipped).toBe(true);
  });

  test("non-existent root returns error", () => {
    const sig = extractCodeSignature(path.join(tmp, "nope"));
    expect(sig.error).toBeDefined();
  });

  test("file-as-root returns error", () => {
    const f = path.join(tmp, "x.js");
    fs.writeFileSync(f, "// nothing");
    const sig = extractCodeSignature(f);
    expect(sig.error).toBeDefined();
  });
});

// ── Framework detection ─────────────────────────────────────────────

describe("extractCodeSignature — frameworks", () => {
  test("Express detected via require + routes captured", () => {
    write(
      "app.js",
      `
        const express = require("express");
        const app = express();
        app.get("/users", (req, res) => res.json([]));
        app.post("/users", async (req, res) => res.json({}));
        app.delete("/users/:id", (req, res) => res.send(""));
        module.exports = app;
      `
    );
    const sig = extractCodeSignature(tmp);
    expect(sig.frameworks).toContain("express");
    // Three routes, three methods
    expect(sig.routes.length).toBe(3);
    const methods = sig.routes.map((r) => r.method);
    expect(methods).toEqual(expect.arrayContaining(["GET", "POST", "DELETE"]));
    const paths = sig.routes.map((r) => r.path);
    expect(paths).toEqual(expect.arrayContaining(["/users", "/users/:id"]));
  });

  test("Next.js + React detected via ESM import", () => {
    write(
      "page.tsx",
      `
        import { useState } from "react";
        import Link from "next/link";
        export default function Page() { return null; }
      `
    );
    const sig = extractCodeSignature(tmp);
    expect(sig.frameworks).toContain("react");
    expect(sig.frameworks).toContain("nextjs");
  });

  test("Fastify routes captured", () => {
    write(
      "server.js",
      `
        const fastify = require("fastify")();
        fastify.get("/health", async () => ({ ok: true }));
        fastify.post("/items", async () => ({}));
      `
    );
    const sig = extractCodeSignature(tmp);
    expect(sig.frameworks).toContain("fastify");
    expect(sig.routes.length).toBe(2);
  });

  test("Multiple LLM SDKs detected", () => {
    write(
      "ai.js",
      `
        const Anthropic = require("@anthropic-ai/sdk");
        const OpenAI = require("openai");
      `
    );
    const sig = extractCodeSignature(tmp);
    expect(sig.frameworks).toContain("anthropic");
    expect(sig.frameworks).toContain("openai");
  });
});

// ── Path-alias filtering ────────────────────────────────────────────

describe("extractCodeSignature — third_party_deps cleanup", () => {
  test("TS path aliases (@/foo, ~/foo) excluded from third_party", () => {
    write(
      "page.tsx",
      `
        import { Button } from "@/components/Button";
        import utils from "~/utils";
        import express from "express";
      `
    );
    const sig = extractCodeSignature(tmp);
    expect(sig.third_party_deps).not.toContain("@/components");
    expect(sig.third_party_deps).not.toContain("~/utils");
    expect(sig.third_party_deps).toContain("express");
  });

  test("relative imports excluded", () => {
    write(
      "x.js",
      `
        const helper = require("./helper");
        const sibling = require("../sibling");
        const express = require("express");
      `
    );
    const sig = extractCodeSignature(tmp);
    expect(sig.third_party_deps).not.toContain("helper");
    expect(sig.third_party_deps).not.toContain("sibling");
    expect(sig.third_party_deps).toContain("express");
  });

  test("Node built-ins (fs, node:path) excluded", () => {
    write(
      "x.js",
      `
        const fs = require("fs");
        const path = require("node:path");
        const os = require("node:os");
        const stripe = require("stripe");
      `
    );
    const sig = extractCodeSignature(tmp);
    expect(sig.third_party_deps).not.toContain("fs");
    expect(sig.third_party_deps).not.toContain("node:path");
    expect(sig.third_party_deps).not.toContain("node:os");
    expect(sig.third_party_deps).toContain("stripe");
  });

  test("scoped packages preserved", () => {
    write(
      "x.js",
      `
        const sdk = require("@anthropic-ai/sdk");
        const node = require("@agentmindsdev/node");
      `
    );
    const sig = extractCodeSignature(tmp);
    expect(sig.third_party_deps).toContain("@anthropic-ai/sdk");
    expect(sig.third_party_deps).toContain("@agentmindsdev/node");
  });
});

// ── Skip dirs ────────────────────────────────────────────────────────

describe("extractCodeSignature — skip dirs", () => {
  test("node_modules / dist / .next not walked", () => {
    write("real.js", `const express = require("express");`);
    write("node_modules/junk.js", `const django = require("django");`);
    write("dist/built.js", `const flask = require("flask");`);
    write(".next/server/x.js", `const koa = require("koa");`);
    const sig = extractCodeSignature(tmp);
    expect(sig.file_count).toBe(1);
    expect(sig.frameworks).toContain("express");
    // Frameworks from skipped dirs absent
    expect(sig.frameworks).not.toContain("koa");
  });
});

// ── Stable hash ──────────────────────────────────────────────────────

describe("extractCodeSignature — signature_hash", () => {
  test("hash is stable across repeat calls on same project", () => {
    write("a.js", `const express = require("express");`);
    const s1 = extractCodeSignature(tmp);
    const s2 = extractCodeSignature(tmp);
    expect(s1.signature_hash).toBe(s2.signature_hash);
  });

  test("hash changes when deps change", () => {
    write("a.js", `const express = require("express");`);
    const s1 = extractCodeSignature(tmp);
    write("a.js", `const express = require("express");\nconst redis = require("redis");`);
    const s2 = extractCodeSignature(tmp);
    expect(s1.signature_hash).not.toBe(s2.signature_hash);
  });
});

// ── File-type filter ────────────────────────────────────────────────

describe("extractCodeSignature — file types", () => {
  test(".d.ts files skipped", () => {
    write("types.d.ts", `declare module "x";`);
    write("real.js", `const express = require("express");`);
    const sig = extractCodeSignature(tmp);
    // Only the .js file is counted
    expect(sig.file_count).toBe(1);
  });

  test("non-source files (.json, .md) skipped", () => {
    write("config.json", `{"x":1}`);
    write("README.md", `# title`);
    write("real.js", `const express = require("express");`);
    const sig = extractCodeSignature(tmp);
    expect(sig.file_count).toBe(1);
  });
});

// ── Async function ratio ────────────────────────────────────────────

describe("extractCodeSignature — function counts", () => {
  test("async functions counted (regex-coarse)", () => {
    write(
      "x.js",
      `
        async function fetchData() { return 1; }
        const x = async () => 2;
        function sync() { return 3; }
      `
    );
    const sig = extractCodeSignature(tmp);
    expect(sig.async_function_count).toBeGreaterThanOrEqual(2);
    expect(sig.function_count).toBeGreaterThanOrEqual(2);
  });
});
