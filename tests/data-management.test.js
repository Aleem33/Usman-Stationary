const { test } = require("node:test");
const assert = require("node:assert/strict");
const bcrypt = require("bcryptjs");
const { openDatabase } = require("../server/db.cjs");
const { saveItem, post } = require("../server/domain.cjs");
const {
  createBackup,
  dataSummary,
  replaceBusinessData,
} = require("../server/data-management.cjs");
const { createApp } = require("../server/app.cjs");
const password = "administrator-test-password";
async function fixture() {
  const db = openDatabase(":memory:");
  const hash = bcrypt.hashSync(password, 4);
  db.prepare("INSERT INTO users(id,name,password) VALUES(1,?,?)").run(
    "admin",
    hash,
  );
  db.prepare("INSERT INTO sessions(token,user_id,expires) VALUES(?,?,?)").run(
    "existing-session",
    1,
    Date.now() + 3600000,
  );
  const item = await saveItem(db, {
    name: "Notebook",
    barcode: "BK01",
    cost: 50,
    price: 100,
    stock: 10,
  });
  db.prepare(
    "INSERT INTO parties(name,kind) VALUES('Customer','customer')",
  ).run();
  db.prepare("INSERT INTO settings(key,value) VALUES(?,?)").run(
    "business_name",
    "Original business",
  );
  const sale = await post(db, {
    type: "sale",
    date: "2026-10-25",
    party_id: 1,
    paid: 100,
    lines: [{ item_id: item, qty: 2, price: 100 }],
  });
  await post(db, {
    type: "sale_return",
    date: "2026-10-25",
    party_id: 1,
    reference_id: sale.id,
    paid: 0,
    lines: [{ item_id: item, qty: 1, price: 100 }],
  });
  return { db, item, hash };
}
test("business backup excludes credentials and reset preserves users and active sessions", async () => {
  const { db, hash } = await fixture();
  try {
    const backup = await createBackup(db);
    assert.equal(backup.tables.users, undefined);
    assert.equal(backup.tables.sessions, undefined);
    assert.ok(!JSON.stringify(backup).includes(hash));
    await replaceBusinessData(db, {
      mode: "reset",
      fingerprint: backup.checksum,
    });
    for (const table of [
      "items",
      "parties",
      "documents",
      "lines",
      "ledger",
      "movements",
      "settings",
    ])
      assert.equal(
        db.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n,
        0,
        table,
      );
    assert.equal(db.prepare("SELECT password FROM users").get().password, hash);
    assert.equal(
      db.prepare("SELECT token FROM sessions").get().token,
      "existing-session",
    );
    assert.equal(
      db.prepare("SELECT action FROM audit").get().action,
      "data.reset",
    );
  } finally {
    db.close();
  }
});
test("restore replaces existing business data and preserves current credentials", async () => {
  const { db } = await fixture();
  try {
    const backup = await createBackup(db);
    const newerHash = bcrypt.hashSync("new-current-password", 4);
    db.prepare("UPDATE users SET password=?").run(newerHash);
    await saveItem(db, {
      name: "New item",
      barcode: "NEW",
      cost: 1,
      price: 2,
      stock: 3,
    });
    db.prepare("UPDATE settings SET value=? WHERE key=?").run(
      "New business",
      "business_name",
    );
    await replaceBusinessData(db, {
      mode: "restore",
      backup,
      fingerprint: (await dataSummary(db)).fingerprint,
    });
    assert.equal(db.prepare("SELECT COUNT(*) n FROM items").get().n, 1);
    assert.equal(
      db.prepare("SELECT COUNT(*) n FROM documents").get().n,
      backup.tables.documents.length,
    );
    assert.equal(
      db.prepare("SELECT value FROM settings WHERE key=?").get("business_name")
        .value,
      "Original business",
    );
    assert.equal(
      db.prepare("SELECT password FROM users").get().password,
      newerHash,
    );
    assert.equal(db.prepare("SELECT COUNT(*) n FROM sessions").get().n, 1);
  } finally {
    db.close();
  }
});
test("damaged backups, login tables and stale previews are rejected without data loss", async () => {
  const { db } = await fixture();
  try {
    const backup = await createBackup(db);
    const damaged = structuredClone(backup);
    damaged.tables.items[0].name = "Edited";
    await assert.rejects(
      () =>
        replaceBusinessData(db, {
          mode: "restore",
          backup: damaged,
          fingerprint: backup.checksum,
        }),
      /checksum/,
    );
    const injected = structuredClone(backup);
    injected.tables.users = [];
    await assert.rejects(
      () =>
        replaceBusinessData(db, {
          mode: "restore",
          backup: injected,
          fingerprint: backup.checksum,
        }),
      /Login data/,
    );
    await saveItem(db, {
      name: "Concurrent update",
      barcode: "CONCURRENT",
      cost: 1,
      price: 2,
    });
    await assert.rejects(
      () =>
        replaceBusinessData(db, {
          mode: "reset",
          fingerprint: backup.checksum,
        }),
      /data changed/,
    );
    assert.equal(db.prepare("SELECT COUNT(*) n FROM items").get().n, 2);
  } finally {
    db.close();
  }
});
test("a foreign-key failure during restore rolls back all deletes and inserts", async () => {
  const { db } = await fixture();
  try {
    const backup = await createBackup(db);
    const invalid = structuredClone(backup);
    delete invalid.checksum;
    invalid.tables.lines[0].document_id = 999999;
    await assert.rejects(
      () =>
        replaceBusinessData(db, {
          mode: "restore",
          backup: invalid,
          fingerprint: backup.checksum,
        }),
      /FOREIGN KEY/,
    );
    assert.deepEqual((await createBackup(db)).tables, backup.tables);
  } finally {
    db.close();
  }
});
test("data controls require the current password and confirmation; restore accepts a file over 1 MB", async () => {
  const { db } = await fixture();
  const server = createApp(db).listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  let token = "";
  const url = "http://127.0.0.1:" + server.address().port + "/api";
  async function request(route, body) {
    const r = await fetch(url + route, {
      method: body ? "POST" : "GET",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: r.status, body: await r.json() };
  }
  try {
    assert.equal((await request("/data/summary")).status, 401);
    const login = await request("/auth", { name: "admin", password });
    token = login.body.token;
    const backup = (await request("/backup")).body;
    const fingerprint = (await request("/data/summary")).body.fingerprint;
    assert.equal(
      (await request("/reset", { password, fingerprint })).status,
      400,
    );
    assert.equal(
      (
        await request("/reset", {
          password: "incorrect",
          confirmation: "RESET",
          fingerprint,
        })
      ).status,
      403,
    );
    assert.equal(db.prepare("SELECT COUNT(*) n FROM items").get().n, 1);
    assert.equal(
      (
        await request("/reset", {
          password,
          confirmation: "RESET",
          fingerprint,
        })
      ).status,
      200,
    );
    assert.equal((await request("/state")).status, 200);
    assert.equal((await request("/health")).body.setup, false);
    const large = structuredClone(backup);
    delete large.checksum;
    large.tables.audit = Array.from({ length: 3500 }, (_, i) => ({
      id: i + 1,
      date: "2026-10-25 00:00:00",
      action: "test",
      detail: "backup detail ".repeat(24),
    }));
    assert.ok(Buffer.byteLength(JSON.stringify(large)) > 1024 * 1024);
    const restored = await request("/restore", {
      password,
      confirmation: "RESTORE",
      fingerprint: (await request("/data/summary")).body.fingerprint,
      backup: large,
    });
    assert.equal(restored.status, 200, JSON.stringify(restored.body));
    assert.equal((await request("/state")).body.items.length, 1);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM users").get().n, 1);
    assert.equal(
      (await request("/auth", { name: "admin", password })).status,
      200,
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
    db.close();
  }
});
