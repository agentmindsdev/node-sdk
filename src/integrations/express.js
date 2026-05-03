"use strict";
/**
 * Express integration.
 *
 * Usage:
 *   const express = require("express");
 *   const agentminds = require("agentminds");
 *   const { requestHandler, errorHandler } = require("agentminds/integrations/express");
 *
 *   agentminds.init({ dsn: "..." });
 *   const app = express();
 *   app.use(requestHandler());                  // BEFORE your routes
 *   // ... routes ...
 *   app.use(errorHandler());                    // AFTER your routes
 *
 * `requestHandler` opens an AsyncLocalStorage scope per request so
 * tags/user/breadcrumbs don't bleed across concurrent calls.
 * `errorHandler` captures any error that hits Express's default chain.
 */

const hub = require("../hub");

function requestHandler() {
  return function agentmindsRequestHandler(req, res, next) {
    hub.runWithScope(() => {
      const route = req.originalUrl ? req.originalUrl.split("?")[0] : req.url;
      hub.setTransaction(`${req.method} ${route}`);
      hub.setTag("http.method", req.method);
      hub.setTag("http.route", route);
      hub.addBreadcrumb({
        category: "http.server",
        message: `${req.method} ${route}`,
        data: req.query && Object.keys(req.query).length ? { query: req.query } : null,
      });

      const start = Date.now();
      res.on("finish", () => {
        if (res.statusCode >= 500) {
          hub.captureEvent({
            type: "error",
            fingerprint: hub.fingerprint("http", res.statusCode, route),
            page_url: route.slice(0, 512),
            payload: {
              kind: "http_5xx",
              status: res.statusCode,
              method: req.method,
              path: route,
              duration_ms: Date.now() - start,
              scope: hub.scopeToDict(),
            },
          });
        }
      });

      next();
    });
  };
}

function errorHandler() {
  // Express recognises a 4-arg fn as an error-handling middleware.
  return function agentmindsErrorHandler(err, req, res, next) {
    try {
      hub.captureException(err, {
        kind: "uncaught",
        http_method: req.method,
        http_path: req.originalUrl || req.url,
      });
    } catch {
      // swallow — never break the response
    }
    next(err);
  };
}

module.exports = { requestHandler, errorHandler };
