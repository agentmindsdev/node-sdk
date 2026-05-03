"use strict";
/**
 * DSN parser tests — symmetric to sdks/python/tests/test_dsn.py.
 */

const { parseDSN, InvalidDSN } = require("../src/dsn");

describe("parseDSN — valid shapes", () => {
  test("minimal valid", () => {
    const d = parseDSN("https://pk_test_abc@api.agentminds.dev/yoursite");
    expect(d.publicKey).toBe("pk_test_abc");
    expect(d.host).toBe("api.agentminds.dev");
    expect(d.scheme).toBe("https");
    expect(d.siteId).toBe("yoursite");
    expect(d.apiBase).toBe("https://api.agentminds.dev");
    expect(d.ingestUrl).toBe(
      "https://api.agentminds.dev/api/v1/sync/ingest/yoursite/events?key=pk_test_abc"
    );
  });

  test("with port", () => {
    const d = parseDSN("http://pk_test@localhost:8000/site");
    expect(d.host).toBe("localhost");
    expect(d.apiBase).toBe("http://localhost:8000");
    expect(d.ingestUrl.startsWith("http://localhost:8000/")).toBe(true);
  });

  test("strips trailing slash from path", () => {
    const d = parseDSN("https://pk_x@host/site/");
    expect(d.siteId).toBe("site");
  });
});

describe("parseDSN — invalid shapes", () => {
  test("empty string throws", () => {
    expect(() => parseDSN("")).toThrow(InvalidDSN);
  });

  test("non-string throws", () => {
    expect(() => parseDSN(undefined)).toThrow(InvalidDSN);
    expect(() => parseDSN(null)).toThrow(InvalidDSN);
    expect(() => parseDSN(123)).toThrow(InvalidDSN);
  });

  test("garbage throws", () => {
    expect(() => parseDSN("definitely not a url")).toThrow(InvalidDSN);
  });

  test("missing username throws", () => {
    expect(() => parseDSN("https://api.agentminds.dev/site")).toThrow(InvalidDSN);
  });

  test("missing path throws", () => {
    expect(() => parseDSN("https://pk_test@api.agentminds.dev/")).toThrow(InvalidDSN);
  });

  test("multi-segment path throws", () => {
    expect(() => parseDSN("https://pk_x@host/my/nested/path")).toThrow(InvalidDSN);
  });
});
