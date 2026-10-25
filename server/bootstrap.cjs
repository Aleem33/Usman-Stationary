const express = require("express");
const { openConfiguredDatabase } = require("./db.cjs");
const { createApp } = require("./app.cjs");

function startServer(options = {}) {
  let handler = null,
    db = null,
    status = "starting";
  const logger = options.logger || console;
  const app = express();
  app.disable("x-powered-by");
  app.use((req, res, next) => {
    if (handler) return handler(req, res, next);
    const origin = req.headers.origin;
    if (
      origin === "null" ||
      [
        "https://store.aleemcore.com",
        "http://127.0.0.1:5173",
        "http://localhost:5173",
        ...(process.env.ALLOWED_ORIGINS || "").split(","),
      ].includes(origin)
    ) {
      res.set("Access-Control-Allow-Origin", origin);
      res.set("Vary", "Origin");
      res.set("Access-Control-Allow-Headers", "Authorization,Content-Type");
      res.set("Access-Control-Allow-Methods", "GET,POST,PUT,OPTIONS");
    }
    if (req.method === "OPTIONS") return res.sendStatus(204);
    res.set("Cache-Control", "no-store");
    res.set("Retry-After", "5");
    res.status(503).json({
      ok: false,
      status,
      error:
        status === "failed"
          ? "Database initialization failed; check the Hostinger runtime logs"
          : "Database is starting; retry shortly",
    });
  });
  // Keep this synchronous: Hostinger requires listen() during entry import.
  const server = app.listen(
    options.port ?? (process.env.PORT ? Number(process.env.PORT) : 4000),
    options.host || process.env.HOST || "127.0.0.1",
    () => logger.log("Usman API listening; database status: " + status),
  );
  const ready = Promise.resolve()
    .then(() => (options.openDatabase || openConfiguredDatabase)())
    .then((database) => {
      db = database;
      handler = (options.createApp || createApp)(db);
      status = "ready";
      logger.log("Usman database ready (" + db.dialect + ")");
      return true;
    })
    .catch((error) => {
      status = "failed";
      logger.error("Database initialization failed:", error.message);
      return false;
    });
  return {
    server,
    ready,
    async close() {
      await new Promise((resolve, reject) =>
        server.close((e) => (e ? reject(e) : resolve())),
      );
      await ready;
      if (db) await db.close();
    },
  };
}
module.exports = { startServer };
