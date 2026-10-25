const { test } = require("node:test");
const assert = require("node:assert/strict");
const { openDatabase } = require("../server/db.cjs");
const { createApp } = require("../server/index.js");
test("API requires setup key, authenticates, persists data and revokes sessions", async () => {
  process.env.SETUP_KEY = "integration-test-key";
  const db = openDatabase(":memory:");
  const server = createApp(db).listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const base = "http://127.0.0.1:" + server.address().port;
  let token = "";
  const request = async (route, body, method = body ? "POST" : "GET") => {
    const res = await fetch(base + "/api" + route, {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: await res.json() };
  };
  try {
    assert.equal((await request("/state")).status, 401);
    assert.equal(
      (
        await request("/auth", {
          name: "admin",
          password: "long-test-password",
        })
      ).status,
      403,
    );
    const auth = await request("/auth", {
      name: "admin",
      password: "long-test-password",
      setup_key: process.env.SETUP_KEY,
    });
    assert.equal(auth.status, 200);
    token = auth.body.token;
    assert.equal(
      (
        await request("/items", {
          name: "Notebook",
          barcode: "001",
          cost: 100,
          price: 150,
          stock: 12,
        })
      ).status,
      200,
    );
    assert.equal((await request("/state")).body.items.length, 1);
    const d = await request("/documents", {
      type: "sale",
      date: "2026-10-25",
      paid: 150,
      lines: [{ item_id: 1, qty: 1, price: 150 }],
    });
    assert.equal(d.status, 200);
    assert.equal(d.body.total, 15000);
    assert.equal((await request("/backup")).body.tables.documents.length, 1);
    assert.equal((await request("/logout", {})).status, 200);
    assert.equal((await request("/state")).status, 401);
  } finally {
    await new Promise((r) => server.close(r));
    db.close();
  }
});
