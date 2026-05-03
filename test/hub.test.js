"use strict";
/**
 * Hub tests — scope, capture API, fingerprint stability.
 *
 * The hub is the per-async-context state container. We don't need a
 * real network client; tests stub `setClient` with a recording
 * implementation that captures enqueue() calls.
 */

const hub = require("../src/hub");

class RecordingClient {
  constructor() { this.events = []; }
  enqueue(event) { this.events.push(event); }
  flush() { return Promise.resolve(true); }
  close() { /* noop */ }
}

let client;
beforeEach(() => {
  client = new RecordingClient();
  hub.setClient(client);
  hub.clearScope();
});

afterEach(() => {
  hub.setClient(null);
});

// ── Initialisation gate ────────────────────────────────────────────

describe("hub — capture without client is a no-op", () => {
  test("captureException without client doesn't throw", () => {
    hub.setClient(null);
    expect(() => hub.captureException(new Error("x"))).not.toThrow();
  });

  test("captureMessage without client doesn't throw", () => {
    hub.setClient(null);
    expect(() => hub.captureMessage("x")).not.toThrow();
  });

  test("captureEvent without client doesn't throw", () => {
    hub.setClient(null);
    expect(() => hub.captureEvent({ type: "error", payload: {} })).not.toThrow();
  });
});

// ── captureException ───────────────────────────────────────────────

describe("hub.captureException", () => {
  test("ships an error event with stack info", () => {
    try {
      throw new Error("boom");
    } catch (e) {
      hub.captureException(e);
    }
    expect(client.events).toHaveLength(1);
    const ev = client.events[0];
    expect(ev.type).toBe("error");
    expect(ev.payload.message).toMatch(/boom/);
    expect(ev.payload.exception_type).toBe("Error");
    expect(ev.payload.stack).toBeTruthy();
    expect(ev.fingerprint).toBeTruthy();
  });

  test("captures from wrapped non-Error throws", () => {
    hub.captureException("string-thrown");
    expect(client.events).toHaveLength(1);
    expect(client.events[0].payload.message).toMatch(/string-thrown/);
  });

  test("merges extra fields into payload", () => {
    hub.captureException(new Error("x"), { kind: "uncaught", extra_field: 42 });
    expect(client.events[0].payload.kind).toBe("uncaught");
    expect(client.events[0].payload.extra_field).toBe(42);
  });

  test("null exception is silently ignored", () => {
    hub.captureException(null);
    expect(client.events).toHaveLength(0);
  });

  test("fingerprint is stable for the same exception name", () => {
    // Two errors with the same name + similar source should hash similarly
    const errs = [];
    for (let i = 0; i < 2; i++) {
      try {
        throw new Error("boom");
      } catch (e) {
        hub.captureException(e);
        errs.push(client.events[client.events.length - 1].fingerprint);
      }
    }
    expect(errs[0]).toBe(errs[1]);
  });
});

// ── captureMessage ──────────────────────────────────────────────────

describe("hub.captureMessage", () => {
  test("ships a custom event for info level", () => {
    hub.captureMessage("hello", "info");
    expect(client.events).toHaveLength(1);
    expect(client.events[0].type).toBe("custom");
    expect(client.events[0].payload.message).toBe("hello");
    expect(client.events[0].payload.level).toBe("info");
  });

  test("non-info level becomes error type", () => {
    hub.captureMessage("oops", "error");
    expect(client.events[0].type).toBe("error");
  });
});

// ── Scope API ──────────────────────────────────────────────────────

describe("hub scope API", () => {
  test("setUser is included in next captured event", () => {
    hub.setUser({ id: 42 });
    hub.captureMessage("ev");
    expect(client.events[0].payload.scope.user).toEqual({ id: 42 });
  });

  test("setTag is included in next captured event", () => {
    hub.setTag("plan", "pro");
    hub.captureMessage("ev");
    expect(client.events[0].payload.scope.tags.plan).toBe("pro");
  });

  test("breadcrumbs included in next captured event", () => {
    hub.addBreadcrumb({ category: "db", message: "SELECT 1" });
    hub.addBreadcrumb({ category: "http", message: "GET /x" });
    hub.captureMessage("ev");
    const crumbs = client.events[0].payload.scope.breadcrumbs;
    expect(crumbs).toHaveLength(2);
    expect(crumbs[0].category).toBe("db");
    expect(crumbs[1].category).toBe("http");
  });

  test("clearScope wipes user/tags/breadcrumbs", () => {
    hub.setUser({ id: 1 });
    hub.setTag("k", "v");
    hub.addBreadcrumb({ message: "x" });
    hub.clearScope();
    hub.captureMessage("ev");
    const scope = client.events[0].payload.scope;
    expect(scope.user).toBeUndefined();
    expect(scope.tags).toBeUndefined();
    expect(scope.breadcrumbs).toBeUndefined();
  });

  test("setTransaction shows on captured event", () => {
    hub.setTransaction("POST /api/payment");
    hub.captureMessage("ev");
    expect(client.events[0].payload.scope.transaction).toBe("POST /api/payment");
  });
});

// ── runWithScope (AsyncLocalStorage isolation) ─────────────────────

describe("hub.runWithScope — per-async-context isolation", () => {
  test("scope set inside is isolated from outside", async () => {
    hub.setUser({ id: "outer" });

    await hub.runWithScope(async () => {
      hub.setUser({ id: "inner" });
      hub.captureMessage("inside");
    });

    hub.captureMessage("outside");

    expect(client.events).toHaveLength(2);
    const insideEvent = client.events.find((e) => e.payload.message === "inside");
    const outsideEvent = client.events.find((e) => e.payload.message === "outside");
    // Inside scope saw inner user; outside still sees the original
    expect(insideEvent.payload.scope.user).toEqual({ id: "inner" });
    expect(outsideEvent.payload.scope.user).toEqual({ id: "outer" });
  });

  test("two concurrent scopes don't bleed", async () => {
    await Promise.all([
      hub.runWithScope(async () => {
        hub.setUser({ id: "A" });
        await new Promise((r) => setTimeout(r, 10));
        hub.captureMessage("from-A");
      }),
      hub.runWithScope(async () => {
        hub.setUser({ id: "B" });
        await new Promise((r) => setTimeout(r, 5));
        hub.captureMessage("from-B");
      }),
    ]);
    const a = client.events.find((e) => e.payload.message === "from-A");
    const b = client.events.find((e) => e.payload.message === "from-B");
    expect(a.payload.scope.user.id).toBe("A");
    expect(b.payload.scope.user.id).toBe("B");
  });
});

// ── Fingerprint helper ─────────────────────────────────────────────

describe("hub.fingerprint", () => {
  test("djb2 produces stable hex for same input", () => {
    expect(hub.fingerprint("a", "b", "c")).toBe(hub.fingerprint("a", "b", "c"));
  });

  test("different input produces different hash", () => {
    expect(hub.fingerprint("a")).not.toBe(hub.fingerprint("b"));
  });

  test("handles null/undefined gracefully", () => {
    expect(() => hub.fingerprint(null, undefined, "")).not.toThrow();
  });
});
