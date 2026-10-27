const assert = require("node:assert/strict"),
  crypto = require("node:crypto");
const { saveItem } = require("../server/domain.cjs");
const pricing = require("../server/store-pricing.cjs");
const {
  catalog,
  submit,
  processRequest,
  fulfillRequest,
  getRequest,
} = require("../server/storefront.cjs");
const {
  createBackup,
  replaceBusinessData,
} = require("../server/data-management.cjs");
module.exports = async function (db) {
  const id = await saveItem(db, {
    name: "Wholesale notebook",
    barcode: "WHOLESALE-001",
    price: 100,
    cost: 40,
    stock: 500,
  });
  const c = pricing.validateConfig({
    ...pricing.defaults(),
    products: {
      [id]: {
        min_qty: 10,
        pack_size: 10,
        carton_size: 50,
        featured: true,
        tiers: [
          { min_qty: 10, price: 90 },
          { min_qty: 50, price: 80 },
        ],
      },
    },
    groups: {
      retailer: { discount: 10, prices: { [id]: 75 } },
      school: { discount: 5, prices: {} },
    },
    bulk: { min_total: 5000, percent: 5 },
  });
  await db
    .prepare("INSERT INTO store_settings(id,payload) VALUES(1,?)")
    .run(JSON.stringify(c));
  const key = crypto.randomUUID(),
    r = await db
      .prepare(
        "INSERT INTO store_customers(customer_key,name,phone,login,password,status,segment) VALUES(?,?,?,?,?,?,?)",
      )
      .run(
        key,
        "Fixture retailer",
        "03000000001",
        "fixture-retailer",
        "preserved-hash",
        "active",
        "retailer",
      );
  const customer = await db
    .prepare("SELECT * FROM store_customers WHERE id=?")
    .get(Number(r.lastInsertRowid));
  const publicItem = (await catalog(db)).items.find((i) => i.id === id),
    privateItem = (await catalog(db, customer)).items.find((i) => i.id === id);
  assert.equal(publicItem.price, 10000);
  assert.deepEqual(
    publicItem.tiers.map((t) => t.price),
    [10000, 9000, 8000],
  );
  assert.equal(publicItem.pack_price, 90000);
  assert.equal(publicItem.carton_price, 400000);
  assert.equal(publicItem.min_qty, 10);
  assert.equal(privateItem.price, 6750);
  assert.equal(privateItem.tiers[1].price, 6750);
  assert.equal(
    (await catalog(db, { ...customer, status: "pending" })).items.find(
      (i) => i.id === id,
    ).price,
    10000,
  );
  assert.equal((await catalog(db)).groups, undefined);
  assert.equal((await catalog(db)).customer, null);
  const body = {
    submission_key: crypto.randomUUID(),
    role: "customer",
    name: "Fixture retailer",
    phone: "03000000001",
    lines: [{ item_id: id, qty: 2, package: "carton", price: 1 }],
  };
  await assert.rejects(
    submit(db, { ...body, lines: [{ item_id: id, qty: 9 }] }),
    /minimum/,
  );
  await assert.rejects(
    submit(db, {
      ...body,
      lines: [{ item_id: id, qty: 1.5, package: "pack" }],
    }),
    /whole package/,
  );
  const sent = await submit(db, body);
  const request = await db
    .prepare("SELECT id FROM storefront_requests WHERE code=?")
    .get(sent.code);
  const detail = await getRequest(db, request.id);
  assert.equal(detail.lines[0].qty, 100);
  assert.equal(detail.lines[0].price, 8000);
  assert.equal(detail.lines[0].discount, 40000);
  assert.equal(detail.total, 760000);
  const order = await processRequest(db, request.id, {});
  assert.equal(order.total, 760000);
  assert.equal(order.discount, 40000);
  const priv = await submit(
    db,
    {
      ...body,
      submission_key: crypto.randomUUID(),
      lines: [{ item_id: id, qty: 1, package: "pack" }],
    },
    customer,
  );
  const req = await db
    .prepare("SELECT id FROM storefront_requests WHERE code=?")
    .get(priv.code);
  const pd = await getRequest(db, req.id);
  assert.equal(pd.lines[0].qty, 10);
  assert.equal(pd.lines[0].price, 6750);
  assert.equal(pd.total, 67500);
  assert.equal(
    (
      await db
        .prepare(
          "SELECT customer_key FROM store_order_links WHERE request_id=?",
        )
        .get(req.id)
    ).customer_key,
    key,
  );
  const po = await processRequest(db, req.id, {});
  await fulfillRequest(db, req.id, {
    type: "sale",
    date: "2026-10-27",
    party_id: po.party_id,
    paid: 0,
    lines: [{ item_id: id, qty: 10, price: 67.5 }],
  });
  assert.ok((await catalog(db)).best_sellers.includes(id));
  const backup = await createBackup(db);
  assert.equal(backup.tables.store_settings.length, 1);
  assert.equal(backup.tables.store_order_links.length, 1);
  assert.equal(backup.tables.store_customers, undefined);
  assert.ok(!JSON.stringify(backup).includes("preserved-hash"));
  await replaceBusinessData(db, {
    mode: "reset",
    fingerprint: backup.checksum,
  });
  assert.equal(
    (
      await db
        .prepare("SELECT password FROM store_customers WHERE id=?")
        .get(customer.id)
    ).password,
    "preserved-hash",
  );
  await replaceBusinessData(db, {
    mode: "restore",
    fingerprint: (await createBackup(db)).checksum,
    backup,
  });
  assert.equal((await pricing.config(db)).products[id].pack_size, 10);
  assert.equal(
    (
      await db
        .prepare(
          "SELECT customer_key FROM store_order_links WHERE request_id=?",
        )
        .get(req.id)
    ).customer_key,
    key,
  );
};
