const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { saveItem, getDocument } = require("../server/domain.cjs");
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
  validateBackup,
} = require("../server/data-management.cjs");
module.exports = async function storefrontCases(db) {
  const item = await saveItem(db, {
    name: "Store notebook",
    barcode: "WEB-TEST-001",
    cost: 10,
    price: 30,
    stock: 20,
  });
  const count = async (table) =>
    Number((await db.prepare(`SELECT COUNT(*) n FROM ${table}`).get()).n);
  const before = {
    documents: await count("documents"),
    parties: await count("parties"),
    ledger: await count("ledger"),
    users: await count("users"),
    sessions: await count("sessions"),
  };
  const stock = async () =>
    (await db.prepare("SELECT stock FROM items WHERE id=?").get(item)).stock;
  const visible = (await catalog(db)).items.find((i) => i.id === item);
  assert.deepEqual(Object.keys(visible).sort(), [
    "available",
    "barcode",
    "category",
    "id",
    "name",
    "price",
    "unit",
  ]);
  const body = {
    submission_key: crypto.randomUUID(),
    role: "customer",
    name: "Online customer",
    phone: "03001234567",
    address: "Test address",
    lines: [{ item_id: item, qty: 2, price: 0 }],
  };
  const results = await Promise.all([submit(db, body), submit(db, body)]);
  assert.equal(results[0].code, results[1].code);
  assert.equal(await count("storefront_requests"), 1);
  let row = await db
    .prepare("SELECT id FROM storefront_requests WHERE code=?")
    .get(results[0].code);
  const detail = await getRequest(db, row.id);
  assert.equal(
    detail.lines[0].price,
    3000,
    "Customer cannot override selling price",
  );
  assert.equal(detail.total, 6000);
  assert.equal(detail.submission_key, undefined);
  assert.equal(await count("documents"), before.documents);
  assert.equal(await count("parties"), before.parties);
  assert.equal(await stock(), 20);
  await assert.rejects(
    submit(db, { ...body, name: "Changed" }),
    /already sent/,
  );
  await assert.rejects(
    submit(db, {
      ...body,
      submission_key: crypto.randomUUID(),
      lines: [{ item_id: item, qty: 0.0001 }],
    }),
    /quantity/,
  );
  await assert.rejects(
    submit(db, {
      ...body,
      submission_key: crypto.randomUUID(),
      role: "supplier",
      lines: [{ item_id: item, qty: 1, price: "" }],
    }),
    /offered price/,
  );
  await assert.rejects(
    submit(db, {
      ...body,
      submission_key: crypto.randomUUID(),
      lines: [{ item_id: 999999, qty: 1 }],
    }),
    /no longer available/,
  );
  const accepted = await Promise.all([
    processRequest(db, row.id, {}),
    processRequest(db, row.id, {}),
  ]);
  assert.equal(accepted[0].id, accepted[1].id);
  assert.equal(accepted[0].type, "sale_order");
  assert.equal(await count("parties"), before.parties + 1);
  assert.equal(await count("documents"), before.documents + 1);
  assert.equal(
    await count("ledger"),
    before.ledger,
    "Accepting orders must not post accounts",
  );
  assert.equal(await stock(), 20);
  const invoice = {
    type: "sale",
    date: "2026-10-27",
    party_id: accepted[0].party_id,
    paid: 0,
    lines: [{ item_id: item, qty: 2, price: 30 }],
  };
  await assert.rejects(
    fulfillRequest(db, row.id, { ...invoice, type: "purchase" }),
    /Invalid transaction type/,
  );
  await assert.rejects(
    fulfillRequest(db, row.id, {
      ...invoice,
      lines: [{ item_id: item, qty: 21, price: 30 }],
    }),
    /stock/i,
  );
  assert.equal((await getRequest(db, row.id)).status, "accepted");
  assert.equal(await count("documents"), before.documents + 1);
  assert.equal(await stock(), 20);
  const invoices = await Promise.all([
    fulfillRequest(db, row.id, invoice),
    fulfillRequest(db, row.id, invoice),
  ]);
  assert.equal(invoices[0].id, invoices[1].id);
  assert.equal(await count("documents"), before.documents + 2);
  assert.equal(await stock(), 18);
  const linked = (await getDocument(db, accepted[0].id)).storefront_request;
  assert.equal(linked.status, "fulfilled");
  assert.equal(linked.document_id, invoices[0].id);
  const supplier = await submit(db, {
    ...body,
    submission_key: crypto.randomUUID(),
    role: "supplier",
    name: "Supplier",
    lines: [{ item_id: item, qty: 3, price: 12 }],
  });
  row = await db
    .prepare("SELECT id FROM storefront_requests WHERE code=?")
    .get(supplier.code);
  const purchaseOrder = await processRequest(db, row.id, {});
  assert.equal(purchaseOrder.type, "purchase_order");
  assert.equal(purchaseOrder.lines[0].price, 1200);
  await fulfillRequest(db, row.id, {
    type: "purchase",
    date: "2026-10-27",
    party_id: purchaseOrder.party_id,
    paid: 0,
    lines: [{ item_id: item, qty: 3, price: 12 }],
  });
  assert.equal(await stock(), 21);
  assert.equal(
    Number(
      (await db.prepare("SELECT SUM(debit-credit) balance FROM ledger").get())
        .balance,
    ),
    0,
  );
  const backup = await createBackup(db);
  assert.equal(backup.tables.storefront_requests.length, 2);
  const broken = structuredClone(backup);
  delete broken.checksum;
  broken.tables.storefront_requests[0].order_id = 999999;
  await assert.rejects(
    replaceBusinessData(db, {
      mode: "restore",
      fingerprint: backup.checksum,
      backup: broken,
    }),
  );
  assert.deepEqual(
    (await createBackup(db)).tables,
    backup.tables,
    "Failed request restore must roll back all business data",
  );
  await replaceBusinessData(db, {
    mode: "reset",
    fingerprint: backup.checksum,
  });
  assert.equal(await count("storefront_requests"), 0);
  await replaceBusinessData(db, {
    mode: "restore",
    fingerprint: (await createBackup(db)).checksum,
    backup,
  });
  assert.equal(await stock(), 21);
  assert.equal((await getRequest(db, row.id)).status, "fulfilled");
  const legacy = structuredClone(backup);
  delete legacy.tables.storefront_requests;
  legacy.checksum = crypto
    .createHash("sha256")
    .update(
      JSON.stringify(
        Object.fromEntries(
          Object.entries(legacy.tables).map(([name, rows]) => [
            name,
            rows.map((r) =>
              Object.fromEntries(
                Object.keys(r)
                  .sort()
                  .map((k) => [k, r[k]]),
              ),
            ),
          ]),
        ),
      ),
    )
    .digest("hex");
  assert.deepEqual(
    (await validateBackup(db, legacy)).tables.storefront_requests,
    [],
  );
  await replaceBusinessData(db, {
    mode: "restore",
    fingerprint: (await createBackup(db)).checksum,
    backup: legacy,
  });
  assert.equal(await count("storefront_requests"), 0);
  assert.equal(await count("users"), before.users);
  assert.equal(await count("sessions"), before.sessions);
};
