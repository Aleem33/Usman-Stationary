const { test } = require("node:test");
const assert = require("node:assert/strict");
const { openMySQL } = require("../server/mysql.cjs");
const { saveItem, post } = require("../server/domain.cjs");
const { report } = require("../server/reports.cjs");
const { reports } = require("../server/catalog.cjs");
const { createApp } = require("../server/app.cjs");
test(
  "real MySQL/MariaDB: schema, CRUD, tax, returns, reports, rollback, concurrent stock and API",
  { skip: process.env.MYSQL_TEST_MODE !== "1" },
  async () => {
    if (!process.env.DB_NAME?.endsWith("_test"))
      throw Error(
        "Integration checks require a dedicated database ending in _test",
      );
    const db = await openMySQL();
    let server;
    try {
      assert.equal(
        (await db.prepare("SELECT COUNT(*) n FROM documents").get()).n,
        0,
        "Refusing to seed a nonempty test database",
      );
      const item = await saveItem(db, {
        name: "Test notebook",
        barcode: "MYSQL-TEST-001",
        cost: 50,
        price: 100,
        stock: 20,
        category: "Paper",
      });
      const p = await db
        .prepare(
          "INSERT INTO parties(name,kind,phone) VALUES('Test party','both','923001234567')",
        )
        .run();
      const party = p.lastInsertRowid;
      const base = { date: "2026-10-25", party_id: party, account: "Cash" };
      const purchase = await post(db, {
        ...base,
        type: "purchase",
        paid: 300,
        lines: [{ item_id: item, qty: 5, price: 60 }],
      });
      const sale = await post(db, {
        ...base,
        type: "sale",
        paid: 100,
        lines: [
          {
            item_id: item,
            qty: 5,
            price: 100,
            discount: 10,
            discount_mode: "percent",
            tax: 18,
            tax_mode: "percent",
          },
        ],
      });
      assert.equal(sale.total, 53100);
      assert.equal(sale.discount, 5000);
      assert.equal(sale.tax, 8100);
      assert.equal(
        (await db.prepare("SELECT stock FROM items WHERE id=?").get(item))
          .stock,
        20,
      );
      const returned = await post(db, {
        ...base,
        type: "sale_return",
        reference_id: sale.id,
        paid: 0,
        lines: [{ item_id: item, qty: 2, price: 1 }],
      });
      assert.equal(returned.total, 21240);
      await assert.rejects(
        () =>
          post(db, {
            ...base,
            type: "sale_return",
            reference_id: sale.id,
            lines: [{ item_id: item, qty: 4, price: 100 }],
          }),
        /exceeds original/,
      );
      await post(db, {
        ...base,
        type: "purchase_return",
        reference_id: purchase.id,
        paid: 60,
        lines: [{ item_id: item, qty: 1, price: 60 }],
      });
      const count = (await db.prepare("SELECT COUNT(*) n FROM documents").get())
        .n;
      await assert.rejects(
        () =>
          post(db, {
            ...base,
            type: "sale",
            lines: [{ item_id: item, qty: 1000, price: 100 }],
          }),
        /Insufficient stock/,
      );
      assert.equal(
        (await db.prepare("SELECT COUNT(*) n FROM documents").get()).n,
        count,
      );
      for (const type of ["quotation", "sale_order", "purchase_order"])
        await post(db, {
          ...base,
          type,
          lines: [{ item_id: item, qty: 1, price: 100 }],
        });
      await post(db, {
        ...base,
        type: "expense",
        amount: 50,
        category: "Utilities",
        notes: "Electricity",
      });
      await post(db, { ...base, type: "opening", amount: 5000 });
      await post(db, { ...base, type: "receipt", amount: 100 });
      await post(db, { ...base, type: "payment", amount: 50 });
      await post(db, {
        ...base,
        type: "transfer",
        to_account: "Bank",
        amount: 100,
      });
      const scarce = await saveItem(db, {
        name: "One remaining item",
        barcode: "MYSQL-TEST-002",
        cost: 10,
        price: 20,
        stock: 1,
      });
      const saleInput = {
        ...base,
        type: "sale",
        paid: 20,
        lines: [{ item_id: scarce, qty: 1, price: 20 }],
      };
      const concurrent = await Promise.allSettled([
        post(db, saleInput),
        post(db, saleInput),
      ]);
      assert.equal(
        concurrent.filter((r) => r.status === "fulfilled").length,
        1,
      );
      assert.equal(
        (await db.prepare("SELECT stock FROM items WHERE id=?").get(scarce))
          .stock,
        0,
      );
      assert.equal(
        (await db.prepare("SELECT SUM(debit-credit) n FROM ledger").get()).n,
        0,
      );
      assert.equal(
        (
          await db
            .prepare("SELECT COUNT(*) n FROM ledger WHERE debit<0 OR credit<0")
            .get()
        ).n,
        0,
      );
      for (const name of Object.values(reports).flat()) {
        const r = await report(db, name, {
          from: "2026-10-01",
          to: "2026-10-31",
        });
        assert.ok(Array.isArray(r.rows), name);
        for (const row of r.rows)
          for (const value of Object.values(row))
            if (typeof value === "number")
              assert.ok(Number.isFinite(value), name);
      }
      process.env.SETUP_KEY = "isolated-ci-setup-key";
      server = createApp(db).listen(0, "127.0.0.1");
      await new Promise((resolve) => server.once("listening", resolve));
      const url = "http://127.0.0.1:" + server.address().port + "/api";
      let token = "";
      async function request(route, body, method = body ? "POST" : "GET") {
        const r = await fetch(url + route, {
          method,
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer " + token,
          },
          body: body ? JSON.stringify(body) : undefined,
        });
        return { status: r.status, body: await r.json() };
      }
      assert.equal((await request("/health")).body.setup, true);
      const auth = await request("/auth", {
        name: "admin",
        password: "ci-only-long-password",
        setup_key: process.env.SETUP_KEY,
      });
      assert.equal(auth.status, 200);
      token = auth.body.token;
      const counterParty = await request("/parties", {
        name: "Counter customer",
        kind: "customer",
      });
      assert.equal(counterParty.status, 200);
      assert.ok(
        Number.isSafeInteger(counterParty.body.id) && counterParty.body.id > 0,
      );
      const editedParty = await request("/parties", {
        id: counterParty.body.id,
        name: "Updated counter customer",
        kind: "both",
      });
      assert.equal(editedParty.body.id, counterParty.body.id);
      assert.equal(
        (await request("/state")).body.parties.find(
          (p) => p.id === counterParty.body.id,
        ).name,
        "Updated counter customer",
      );
      assert.equal(
        (
          await request(
            "/settings",
            { business_name: "MySQL integration store" },
            "PUT",
          )
        ).status,
        200,
      );
      assert.equal(
        (await request("/settings", { business_name: "Updated store" }, "PUT"))
          .status,
        200,
      );
      const state = await request("/state");
      assert.equal(state.status, 200);
      assert.equal(state.body.settings.business_name, "Updated store");
      assert.equal(state.body.items.length, 2);
      const backup = await request("/backup");
      assert.equal(backup.status, 200);
      assert.ok(backup.body.tables.documents.length > 5);
      const password = "ci-only-long-password";
      const beforeSummary = (await request("/data/summary")).body;
      assert.equal(
        (
          await request("/reset", {
            password: "incorrect",
            confirmation: "RESET",
            fingerprint: beforeSummary.fingerprint,
          })
        ).status,
        403,
      );
      assert.equal(
        (
          await request("/reset", {
            password,
            confirmation: "RESET",
            fingerprint: beforeSummary.fingerprint,
          })
        ).status,
        200,
      );
      assert.equal((await request("/state")).body.items.length, 0);
      assert.equal((await request("/health")).body.setup, false);
      const newItem = (
        await request("/items", {
          name: "After reset",
          barcode: "AFTERRESET",
          cost: 10,
          price: 20,
          stock: 2,
        })
      ).body.id;
      const first = await request("/documents", {
        type: "sale",
        date: "2026-10-25",
        paid: 20,
        lines: [{ item_id: newItem, qty: 1, price: 20 }],
      });
      const second = await request("/documents", {
        type: "sale",
        date: "2026-10-25",
        paid: 20,
        lines: [{ item_id: newItem, qty: 1, price: 20 }],
      });
      assert.equal(first.body.number, "INV-000001");
      assert.equal(second.body.number, "INV-000002");
      const invalid = structuredClone(backup.body);
      delete invalid.checksum;
      invalid.tables.lines[0].document_id = 999999;
      const priorRestore = (await request("/data/summary")).body.fingerprint;
      assert.equal(
        (
          await request("/restore", {
            password,
            confirmation: "RESTORE",
            fingerprint: priorRestore,
            backup: invalid,
          })
        ).status,
        400,
      );
      assert.equal(
        (await request("/state")).body.documents.length,
        2,
        "Failed restore must roll back existing data",
      );
      const restored = await request("/restore", {
        password,
        confirmation: "RESTORE",
        fingerprint: priorRestore,
        backup: backup.body,
      });
      assert.equal(restored.status, 200, JSON.stringify(restored.body));
      assert.equal((await request("/state")).body.items.length, 2);
      assert.equal(
        (await request("/state")).body.settings.business_name,
        "Updated store",
      );
      assert.equal(
        (await request("/auth", { name: "admin", password })).status,
        200,
      );
      assert.equal(
        (
          await request("/password", {
            current_password: password,
            new_password: "new123",
            confirm_password: "new123",
          })
        ).status,
        200,
      );
      assert.equal(
        (await request("/state")).status,
        200,
        "Password change must preserve the current session",
      );
      assert.equal(
        (await request("/auth", { name: "admin", password })).status,
        401,
      );
      process.env.PASSWORD_RESET_KEY = "isolated-mysql-private-recovery-key";
      assert.equal(
        (
          await request("/auth/reset-password", {
            name: "admin",
            recovery_key: process.env.PASSWORD_RESET_KEY,
            new_password: "reset6",
            confirm_password: "reset6",
          })
        ).status,
        200,
      );
      assert.equal((await request("/state")).status, 401);
      const recovered = await request("/auth", {
        name: "admin",
        password: "reset6",
      });
      assert.equal(recovered.status, 200);
      token = recovered.body.token;
      assert.equal(
        (await request("/state")).body.items.length,
        2,
        "Password recovery must preserve business data",
      );
      assert.equal((await request("/logout", {})).status, 200);
      assert.equal((await request("/state")).status, 401);
      await require("./storefront-cases.cjs")(db);
    } finally {
      if (server) await new Promise((resolve) => server.close(resolve));
      await db.close();
    }
  },
);
