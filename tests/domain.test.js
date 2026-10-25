const { test } = require("node:test");
const assert = require("node:assert/strict");
const { openDatabase } = require("../server/db.cjs");
const { post, saveItem } = require("../server/domain.cjs");
const { report } = require("../server/reports.cjs");
const { reports } = require("../server/catalog.cjs");
async function fixture() {
  const db = openDatabase(":memory:");
  const item = await saveItem(db, {
    name: "Ballpoint pen",
    barcode: "PEN001",
    category: "Pens",
    unit: "pcs",
    cost: 50,
    price: 100,
    stock: 100,
    min_stock: 5,
  });
  await db
    .prepare(
      "INSERT INTO parties(name,kind,phone) VALUES('Test customer','both','923001234567')",
    )
    .run();
  return {
    db,
    item,
    party: 1,
  };
}
async function document(f, type, extra = {}) {
  return await post(f.db, {
    type,
    date: "2026-10-25",
    party_id: f.party,
    account: "Cash",
    paid: 0,
    lines: [
      {
        item_id: f.item,
        qty: 10,
        price: type.startsWith("purchase") ? 50 : 100,
        discount: 10,
        discount_mode: "percent",
        tax: 18,
        tax_mode: "percent",
      },
    ],
    ...extra,
  });
}
test("sale posts exact tax/discount, stock, COGS and balanced ledger", async () => {
  const f = await fixture();
  const d = await document(f, "sale", {
    paid: 500,
  });
  assert.equal(d.subtotal, 100000);
  assert.equal(d.discount, 10000);
  assert.equal(d.tax, 16200);
  assert.equal(d.total, 106200);
  assert.equal(d.cost, 50000);
  assert.equal((await f.db.prepare("SELECT stock FROM items").get()).stock, 90);
  assert.equal(
    (await f.db.prepare("SELECT SUM(debit-credit) n FROM ledger").get()).n,
    0,
  );
  assert.equal(
    (
      await f.db
        .prepare(
          "SELECT SUM(debit-credit) n FROM ledger WHERE account='Accounts receivable'",
        )
        .get()
    ).n,
    56200,
  );
  f.db.close();
});
test("failed oversell rolls back document, inventory and ledger", async () => {
  const f = await fixture();
  await assert.rejects(
    async () =>
      await document(f, "sale", {
        lines: [
          {
            item_id: f.item,
            qty: 101,
            price: 100,
          },
        ],
      }),
    /Insufficient stock/,
  );
  assert.equal(
    (await f.db.prepare("SELECT COUNT(*) n FROM documents").get()).n,
    0,
  );
  assert.equal(
    (await f.db.prepare("SELECT stock FROM items").get()).stock,
    100,
  );
  f.db.close();
});
test("returns preserve original price, tax and discount; over-return rejected", async () => {
  const f = await fixture();
  const d = await document(f, "sale");
  const r = await document(f, "sale_return", {
    reference_id: d.id,
    lines: [
      {
        item_id: f.item,
        qty: 4,
        price: 1,
      },
    ],
  });
  assert.equal(r.total, 42480);
  assert.equal((await f.db.prepare("SELECT stock FROM items").get()).stock, 94);
  await assert.rejects(
    async () =>
      await document(f, "sale_return", {
        reference_id: d.id,
        lines: [
          {
            item_id: f.item,
            qty: 7,
            price: 1,
          },
        ],
      }),
    /exceeds original/,
  );
  assert.equal(
    (await f.db.prepare("SELECT SUM(debit-credit) n FROM ledger").get()).n,
    0,
  );
  f.db.close();
});
test("purchase adds stock and weighted average cost; purchase return reverses", async () => {
  const f = await fixture();
  const d = await document(f, "purchase", {
    lines: [
      {
        item_id: f.item,
        qty: 100,
        price: 70,
      },
    ],
    paid: 7000,
  });
  assert.equal(
    (await f.db.prepare("SELECT stock FROM items").get()).stock,
    200,
  );
  assert.equal((await f.db.prepare("SELECT cost FROM items").get()).cost, 6000);
  await document(f, "purchase_return", {
    reference_id: d.id,
    lines: [
      {
        item_id: f.item,
        qty: 20,
        price: 70,
      },
    ],
    paid: 1400,
  });
  assert.equal(
    (await f.db.prepare("SELECT stock FROM items").get()).stock,
    180,
  );
  assert.equal(
    (await f.db.prepare("SELECT SUM(debit-credit) n FROM ledger").get()).n,
    0,
  );
  f.db.close();
});
test("quotations and orders never change inventory or ledger", async () => {
  const f = await fixture();
  for (const type of ["quotation", "sale_order", "purchase_order"])
    await document(f, type);
  assert.equal(
    (await f.db.prepare("SELECT stock FROM items").get()).stock,
    100,
  );
  assert.equal(
    (await f.db.prepare("SELECT COUNT(*) n FROM ledger").get()).n,
    2,
  );
  f.db.close();
});
test("cash, bank, receipts, expenses and transfers balance", async () => {
  const f = await fixture();
  await document(f, "sale");
  await post(f.db, {
    type: "opening",
    date: "2026-10-25",
    account: "Cash",
    amount: 10000,
  });
  await post(f.db, {
    type: "receipt",
    date: "2026-10-25",
    party_id: 1,
    account: "Cash",
    amount: 500,
  });
  await post(f.db, {
    type: "transfer",
    date: "2026-10-25",
    account: "Cash",
    to_account: "Bank",
    amount: 1000,
  });
  await post(f.db, {
    type: "expense",
    date: "2026-10-25",
    account: "Bank",
    amount: 200,
    category: "Utilities",
    notes: "Electricity",
  });
  assert.equal(
    (
      await f.db
        .prepare("SELECT SUM(debit-credit) n FROM ledger WHERE account='Bank'")
        .get()
    ).n,
    80000,
  );
  assert.equal(
    (await f.db.prepare("SELECT SUM(debit-credit) n FROM ledger").get()).n,
    0,
  );
  f.db.close();
});
test("all 34 requested report entries produce data or a valid empty result", async () => {
  const f = await fixture();
  await document(f, "sale");
  await document(f, "purchase");
  await document(f, "quotation");
  await document(f, "sale_order");
  await document(f, "purchase_order");
  await post(f.db, {
    type: "expense",
    date: "2026-10-25",
    account: "Cash",
    amount: 50,
    category: "Rent",
  });
  const names = Object.values(reports).flat();
  assert.equal(names.length, 34);
  for (const name of names) {
    const result = await report(f.db, name, {
      from: "2026-10-01",
      to: "2026-10-31",
    });
    assert.ok(Array.isArray(result.rows), name);
    assert.ok(result.note, name);
    for (const row of result.rows)
      for (const value of Object.values(row))
        if (typeof value === "number") assert.ok(Number.isFinite(value), name);
  }
  const trial = await report(f.db, "Trial Balance", {
    to: "2026-10-31",
  });
  assert.equal(
    trial.rows.reduce((n, r) => n + r.Balance, 0),
    0,
  );
  const pl = await report(f.db, "Profit & Loss", {
    from: "2026-10-01",
    to: "2026-10-31",
  });
  assert.equal(pl.rows.at(-1).Amount, 350);
  f.db.close();
});
test("invalid money, duplicate rows and credit without party are rejected", async () => {
  const f = await fixture();
  await assert.rejects(
    async () =>
      await document(f, "sale", {
        paid: -1,
      }),
    /non-negative/,
  );
  await assert.rejects(
    async () =>
      await document(f, "sale", {
        party_id: null,
      }),
    /party/,
  );
  await assert.rejects(
    async () =>
      await document(f, "sale", {
        lines: [
          {
            item_id: 1,
            qty: 1,
            price: 10,
          },
          {
            item_id: 1,
            qty: 1,
            price: 10,
          },
        ],
      }),
    /duplicate/,
  );
  await assert.rejects(
    async () =>
      await document(f, "sale", {
        lines: [
          {
            item_id: 1,
            qty: 1,
            price: 10,
            discount: 101,
            discount_mode: "percent",
          },
        ],
      }),
    /100%/,
  );
  f.db.close();
});
test("purchase return records cost variance and uses positive debit/credit columns", async () => {
  const f = await fixture();
  const d = await document(f, "purchase", {
    lines: [
      {
        item_id: f.item,
        qty: 100,
        price: 70,
      },
    ],
    paid: 7000,
  });
  const r = await document(f, "purchase_return", {
    reference_id: d.id,
    lines: [
      {
        item_id: f.item,
        qty: 20,
        price: 70,
      },
    ],
    paid: 1400,
  });
  assert.equal(
    (
      await f.db
        .prepare(
          "SELECT SUM(credit-debit) n FROM ledger WHERE document_id=? AND account='Purchase price variance'",
        )
        .get(r.id)
    ).n,
    20000,
  );
  assert.equal(
    (
      await f.db
        .prepare("SELECT COUNT(*) n FROM ledger WHERE debit<0 OR credit<0")
        .get()
    ).n,
    0,
  );
  assert.equal(
    (await f.db.prepare("SELECT SUM(debit-credit) n FROM ledger").get()).n,
    0,
  );
  f.db.close();
});
test("sale return restores original COGS and reweights stock after later purchases", async () => {
  const f = await fixture();
  const d = await document(f, "sale", {
    lines: [
      {
        item_id: f.item,
        qty: 50,
        price: 100,
      },
    ],
    paid: 5000,
  });
  await document(f, "purchase", {
    lines: [
      {
        item_id: f.item,
        qty: 50,
        price: 100,
      },
    ],
    paid: 5000,
  });
  assert.equal((await f.db.prepare("SELECT cost FROM items").get()).cost, 7500);
  const r = await document(f, "sale_return", {
    reference_id: d.id,
    lines: [
      {
        item_id: f.item,
        qty: 50,
        price: 100,
      },
    ],
    paid: 5000,
  });
  assert.equal(r.cost, 250000);
  assert.equal((await f.db.prepare("SELECT cost FROM items").get()).cost, 6667);
  assert.equal(
    (await f.db.prepare("SELECT SUM(debit-credit) n FROM ledger").get()).n,
    0,
  );
  f.db.close();
});
