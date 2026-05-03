"use strict";
/**
 * DSN parser — `https://pk_xxx@api.agentminds.dev/site_id`.
 * Mirrors the Python SDK's _dsn.py so the wire format is identical.
 */

class InvalidDSN extends Error {
  constructor(msg) {
    super(msg);
    this.name = "InvalidDSN";
  }
}

function parseDSN(dsn) {
  if (!dsn || typeof dsn !== "string") {
    throw new InvalidDSN("DSN must be a non-empty string");
  }
  let url;
  try {
    url = new URL(dsn);
  } catch (e) {
    throw new InvalidDSN(`DSN is not a valid URL: ${dsn}`);
  }
  if (!url.username) {
    throw new InvalidDSN("DSN missing public key (username portion before @)");
  }
  if (!url.hostname) {
    throw new InvalidDSN("DSN missing host");
  }
  const siteId = url.pathname.replace(/^\/+|\/+$/g, "");
  if (!siteId) {
    throw new InvalidDSN("DSN missing site_id (path component after host)");
  }
  if (siteId.includes("/")) {
    throw new InvalidDSN(`DSN site_id must be a single segment, got: ${siteId}`);
  }
  const port = url.port ? `:${url.port}` : "";
  const apiBase = `${url.protocol}//${url.hostname}${port}`;
  return {
    publicKey: url.username,
    host: url.hostname,
    scheme: url.protocol.replace(":", "") || "https",
    siteId,
    apiBase,
    ingestUrl: `${apiBase}/api/v1/sync/ingest/${encodeURIComponent(siteId)}/events?key=${encodeURIComponent(url.username)}`,
  };
}

module.exports = { parseDSN, InvalidDSN };
