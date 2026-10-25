const { test } = require("node:test");
const assert = require("node:assert/strict");
const { openMySQL } = require("../server/mysql.cjs");
const { saveItem, post } = require("../server/domain.cjs");
const { report } = require("../server/reports.cjs");
const { reports } = require("../server/catalog.cjs");
const { createApp } = require("../server/index.js");
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
      assert.equal((await request("/logout", {})).status, 200);
      assert.equal((await request("/state")).status, 401);
    } finally {
      if (server) await new Promise((resolve) => server.close(resolve));
      await db.close();
    }
  },
);
