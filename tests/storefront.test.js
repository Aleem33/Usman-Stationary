const { test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { openDatabase } = require("../server/db.cjs");
const { createApp } = require("../server/app.cjs");
const { saveItem } = require("../server/domain.cjs");
test("store requests preserve stock until approved, prevent duplicate processing, and survive backup/restore", async () => {
  const db = openDatabase(":memory:");
  try {
    await require("./storefront-cases.cjs")(db);
  } finally {
    db.close();
  }
});
test("public store serves a catalog without private records; staff actions require login", async () => {
  const db = openDatabase(":memory:");
  const id = await saveItem(db, {
    name: "Public notebook",
    barcode: "PUBLIC",
    cost: 10,
    price: 30,
    stock: 10,
  });
  const server = createApp(db).listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const base = "http://127.0.0.1:" + server.address().port;
  try {
    const html = await fetch(base + "/usmanstationary");
    assert.equal(html.status, 200);
    assert.match(await html.text(), /Your request/);
    assert.equal((await fetch(base + "/usmanstationary/store.js")).status, 200);
    const catalog = await (
      await fetch(base + "/api/storefront/catalog")
    ).json();
    assert.equal(catalog.items[0].cost, undefined);
    assert.equal(catalog.items[0].stock, undefined);
    for (const route of [
      "/api/state",
      "/api/backup",
      "/api/storefront/requests/1",
    ])
      assert.equal((await fetch(base + route)).status, 401);
    for (const action of ["accept", "reject", "fulfill"])
      assert.equal(
        (
          await fetch(base + "/api/storefront/requests/1/" + action, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: "{}",
          })
        ).status,
        401,
      );
    const submit = await fetch(base + "/api/storefront/requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        role: "customer",
        name: "Client",
        phone: "03001234567",
        submission_key: crypto.randomUUID(),
        party_id: 99999,
        lines: [{ item_id: id, qty: 2, price: 0 }],
      }),
    });
    assert.equal(submit.status, 201);
    const response = await submit.json();
    assert.match(response.code, /^WEB-/);
    assert.deepEqual(Object.keys(response).sort(), ["code", "status"]);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM documents").get().n, 0);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM parties").get().n, 0);
    db.prepare("INSERT INTO users(id,name,password) VALUES(1,?,?)").run(
      "admin",
      require("bcryptjs").hashSync("abcdef", 4),
    );
    const auth = await (
      await fetch(base + "/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "admin", password: "abcdef" }),
      })
    ).json();
    const headers = {
      "Content-Type": "application/json",
      Authorization: "Bearer " + auth.token,
    };
    const requestId = db.prepare("SELECT id FROM storefront_requests").get().id;
    assert.equal(
      (
        await fetch(base + `/api/storefront/requests/${requestId}/reject`, {
          method: "POST",
          headers,
          body: "{}",
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await fetch(base + `/api/storefront/requests/${requestId}/accept`, {
          method: "POST",
          headers,
          body: "{}",
        })
      ).status,
      409,
    );
    assert.equal(
      db.prepare("SELECT status FROM storefront_requests").get().status,
      "rejected",
    );
    assert.equal(db.prepare("SELECT COUNT(*) n FROM documents").get().n, 0);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    db.close();
  }
});
