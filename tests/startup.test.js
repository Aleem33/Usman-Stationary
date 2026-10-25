const { test } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const { startServer } = require("../server/bootstrap.cjs");
const logger = { log() {}, error() {} };
test("listens before asynchronous database setup and gates requests until ready", async () => {
  let resolveDatabase,
    closed = false;
  const database = new Promise((resolve) => (resolveDatabase = resolve));
  const runtime = startServer({
    port: 0,
    host: "127.0.0.1",
    logger,
    openDatabase: () => database,
    createApp: () => {
      const app = express();
      app.get("/api/health", (req, res) => res.json({ ok: true }));
      return app;
    },
  });
  try {
    await new Promise((resolve) => runtime.server.once("listening", resolve));
    const url =
      "http://127.0.0.1:" + runtime.server.address().port + "/api/health";
    const starting = await fetch(url);
    assert.equal(starting.status, 503);
    assert.equal((await starting.json()).status, "starting");
    resolveDatabase({
      dialect: "test",
      close() {
        closed = true;
      },
    });
    assert.equal(await runtime.ready, true);
    const ready = await fetch(url);
    assert.equal(ready.status, 200);
    assert.equal((await ready.json()).ok, true);
  } finally {
    resolveDatabase?.({
      dialect: "test",
      close() {
        closed = true;
      },
    });
    await runtime.close();
  }
  assert.equal(closed, true);
});
test("failed database startup stays unhealthy and provides a useful non-secret response", async () => {
  const runtime = startServer({
    port: 0,
    host: "127.0.0.1",
    logger,
    openDatabase: async () => {
      throw Error("private connection details");
    },
  });
  try {
    await new Promise((resolve) => runtime.server.once("listening", resolve));
    assert.equal(await runtime.ready, false);
    const response = await fetch(
      "http://127.0.0.1:" + runtime.server.address().port + "/api/health",
    );
    assert.equal(response.status, 503);
    const data = await response.json();
    assert.equal(data.status, "failed");
    assert.equal(data.ok, false);
    assert.ok(!data.error.includes("private connection details"));
  } finally {
    await runtime.close();
  }
});
test("Hostinger-style import of entry file calls listen without require.main", async () => {
  const envKeys = [
    "PORT",
    "HOST",
    "DB_HOST",
    "DB_CLIENT",
    "DB_PATH",
    "NODE_ENV",
  ];
  const previous = Object.fromEntries(
    envKeys.map((key) => [key, process.env[key]]),
  );
  process.env.PORT = "0";
  process.env.HOST = "127.0.0.1";
  process.env.DB_PATH = ":memory:";
  process.env.DB_CLIENT = "sqlite";
  process.env.NODE_ENV = "test";
  delete process.env.DB_HOST;
  const runtime = require("../server/index.js");
  try {
    if (!runtime.server.listening)
      await new Promise((resolve) => runtime.server.once("listening", resolve));
    assert.ok(runtime.server.address().port > 0);
    await runtime.ready;
  } finally {
    await runtime.close();
    for (const key of envKeys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
});
