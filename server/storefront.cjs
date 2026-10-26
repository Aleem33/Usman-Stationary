const crypto = require("node:crypto");
const { text, money, postInTransaction, getDocument } = require("./domain.cjs");
const fail = (message, status = 400) => {
  throw Object.assign(Error(message), { status });
};
const publicItem = (i) => ({
  id: i.id,
  name: i.name,
  barcode: i.barcode,
  category: i.category,
  unit: i.unit,
  price: i.price,
  available: i.stock > 0,
});
async function catalog(db) {
  return db.transaction(async () => {
    const settings = Object.fromEntries(
      (await db.prepare("SELECT * FROM settings").all()).map((r) => [
        r.key,
        r.value,
      ]),
    );
    return {
      business: {
        name: settings.business_name || "Usman Stationary",
        phone: settings.phone || "",
        address: settings.address || "",
      },
      currency: "PKR",
      items: (
        await db
          .prepare(
            "SELECT id,name,barcode,category,unit,price,stock FROM items ORDER BY name",
          )
          .all()
      ).map(publicItem),
    };
  });
}
function normalize(b) {
  if (!b || !["customer", "supplier"].includes(b.role))
    fail("Choose customer or supplier");
  const name = text(b.name),
    phone = text(b.phone, 30).replace(/[\s()+-]/g, "");
  if (!/^\d{7,15}$/.test(phone)) fail("Enter a valid phone or WhatsApp number");
  if (b.website) fail("Unable to submit this request");
  if (!/^[a-zA-Z0-9-]{16,64}$/.test(b.submission_key || ""))
    fail("Reload the page before submitting");
  if (!Array.isArray(b.lines) || !b.lines.length || b.lines.length > 100)
    fail("Choose 1–100 products");
  const seen = new Set();
  const lines = b.lines.map((l) => {
    if (!l || typeof l !== "object") fail("Choose a valid product");
    const item_id = Number(l.item_id),
      qty = Number(l.qty);
    if (!Number.isSafeInteger(item_id) || item_id <= 0 || seen.has(item_id))
      fail("Invalid or duplicate product");
    seen.add(item_id);
    if (
      !Number.isFinite(qty) ||
      qty <= 0 ||
      qty > 100000 ||
      Math.abs(qty * 1000 - Math.round(qty * 1000)) > 0.000001
    )
      fail("Enter a positive quantity with up to three decimals");
    if (b.role === "supplier" && (l.price === "" || l.price == null))
      fail("Enter an offered price for every product");
    return {
      item_id,
      qty,
      ...(b.role === "supplier" ? { price: money(l.price) } : {}),
    };
  });
  return {
    role: b.role,
    name,
    phone,
    address: String(b.address || "")
      .trim()
      .slice(0, 300),
    notes: String(b.notes || "")
      .trim()
      .slice(0, 1000),
    lines,
  };
}
async function submit(db, b) {
  const input = normalize(b),
    hash = crypto
      .createHash("sha256")
      .update(JSON.stringify(input))
      .digest("hex");
  return db.transaction(async () => {
    const existing = await db
      .prepare(
        "SELECT code,status,submission_hash FROM storefront_requests WHERE submission_key=?",
      )
      .get(b.submission_key);
    if (existing) {
      if (existing.submission_hash !== hash)
        fail(
          "This submission was already sent. Start a new request to change it.",
          409,
        );
      return { code: existing.code, status: existing.status };
    }
    const since = new Date(Date.now() - 15 * 60000)
      .toISOString()
      .slice(0, 19)
      .replace("T", " ");
    if (
      (
        await db
          .prepare(
            "SELECT COUNT(*) n FROM storefront_requests WHERE phone=? AND created_at>=?",
          )
          .get(input.phone, since)
      ).n >= 10
    )
      fail(
        "Too many requests for this phone number. Please try again in 15 minutes.",
        429,
      );
    const lines = [];
    let total = 0;
    for (const l of input.lines) {
      const item = await db
        .prepare("SELECT * FROM items WHERE id=?")
        .get(l.item_id);
      if (!item)
        fail(
          "A selected product is no longer available. Refresh the catalog.",
          409,
        );
      const price = input.role === "supplier" ? l.price : item.price;
      const lineTotal = Math.round(l.qty * price);
      total += lineTotal;
      if (!Number.isSafeInteger(total) || total > 1e12)
        fail("Request value is too large");
      lines.push({
        item_id: item.id,
        name: item.name,
        barcode: item.barcode,
        unit: item.unit,
        qty: l.qty,
        price,
        total: lineTotal,
      });
    }
    const code = "WEB-" + crypto.randomBytes(6).toString("hex").toUpperCase();
    await db
      .prepare(
        "INSERT INTO storefront_requests(submission_key,submission_hash,code,role,contact_name,phone,address,notes,payload,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
      )
      .run(
        b.submission_key,
        hash,
        code,
        input.role,
        input.name,
        input.phone,
        input.address,
        input.notes,
        JSON.stringify({ lines, total }),
        new Date().toISOString().slice(0, 19).replace("T", " "),
      );
    return { code, status: "pending" };
  });
}
async function listRequests(db) {
  return db
    .prepare(
      "SELECT id,code,role,contact_name,phone,status,order_id,document_id,created_at FROM storefront_requests ORDER BY CASE WHEN status='pending' THEN 0 WHEN status='accepted' THEN 1 ELSE 2 END,id DESC LIMIT 500",
    )
    .all();
}
async function getRequest(db, id) {
  const row = await db
    .prepare("SELECT * FROM storefront_requests WHERE id=?")
    .get(Number(id));
  if (!row) fail("Store request not found", 404);
  const { submission_key, submission_hash, payload, ...publicRow } = row;
  return { ...publicRow, ...JSON.parse(payload) };
}
async function processRequest(db, id, body) {
  return db.transaction(async () => {
    const request = await getRequest(db, id);
    if (request.status === "accepted" || request.status === "fulfilled")
      return getDocument(db, request.order_id);
    if (request.status !== "pending")
      fail("This request has already been rejected", 409);
    let party_id = Number(body.party_id) || null;
    if (party_id) {
      if (
        !(await db.prepare("SELECT id FROM parties WHERE id=?").get(party_id))
      )
        fail("Select a valid contact");
    } else {
      party_id = Number(
        (
          await db
            .prepare(
              "INSERT INTO parties(name,kind,phone,address) VALUES(?,?,?,?)",
            )
            .run(
              request.contact_name,
              request.role,
              request.phone,
              request.address,
            )
        ).lastInsertRowid,
      );
    }
    const defaultTax =
      Number(
        (
          await db
            .prepare("SELECT value FROM settings WHERE `key`=?")
            .get("default_tax")
        )?.value,
      ) || 0;
    const order = await postInTransaction(db, {
      type: request.role === "customer" ? "sale_order" : "purchase_order",
      date: new Date().toLocaleDateString("en-CA", {
        timeZone: "Asia/Karachi",
      }),
      party_id,
      paid: 0,
      notes: (request.code + " · " + request.notes).slice(0, 1000),
      lines: request.lines.map((l) => ({
        item_id: l.item_id,
        qty: l.qty,
        price: l.price / 100,
        tax: defaultTax,
        tax_mode: "percent",
      })),
    });
    await db
      .prepare(
        "UPDATE storefront_requests SET status='accepted',order_id=?,updated_at=? WHERE id=?",
      )
      .run(order.id, new Date().toISOString(), request.id);
    await db
      .prepare("INSERT INTO audit(action,detail) VALUES(?,?)")
      .run("storefront.accepted", request.code);
    return getDocument(db, order.id);
  });
}
async function fulfillRequest(db, id, body) {
  return db.transaction(async () => {
    const request = await getRequest(db, id);
    if (request.status === "fulfilled")
      return getDocument(db, request.document_id);
    if (request.status !== "accepted")
      fail("Accept this request as an order before processing it", 409);
    const expected = request.role === "customer" ? "sale" : "purchase";
    if (body.type !== expected)
      fail("Invalid transaction type for this request");
    const document = await postInTransaction(db, body);
    await db
      .prepare(
        "UPDATE storefront_requests SET status='fulfilled',document_id=?,updated_at=? WHERE id=?",
      )
      .run(document.id, new Date().toISOString(), request.id);
    await db
      .prepare("INSERT INTO audit(action,detail) VALUES(?,?)")
      .run("storefront.fulfilled", request.code + " " + document.number);
    return document;
  });
}
function registerPublic(app, db, wrap) {
  const attempts = new Map();
  app.get(
    "/api/storefront/catalog",
    wrap(async (req, res) => res.json(await catalog(db))),
  );
  app.post(
    "/api/storefront/requests",
    wrap(async (req, res) => {
      const now = Date.now(),
        key = req.ip;
      for (const [ip, value] of attempts)
        if (value.until < now) attempts.delete(ip);
      const attempt = attempts.get(key) || {
        count: 0,
        until: now + 15 * 60000,
      };
      if (attempt.count >= 100 || attempts.size > 10000)
        fail("Too many submissions. Please try again later.", 429);
      attempt.count++;
      attempts.set(key, attempt);
      res.status(201).json(await submit(db, req.body));
    }),
  );
}
function registerPrivate(app, db, wrap) {
  app.get(
    "/api/storefront/requests/:id",
    wrap(async (req, res) =>
      res.json(await db.transaction(() => getRequest(db, req.params.id))),
    ),
  );
  app.post(
    "/api/storefront/requests/:id/accept",
    wrap(async (req, res) =>
      res.json(await processRequest(db, req.params.id, req.body)),
    ),
  );
  app.post(
    "/api/storefront/requests/:id/fulfill",
    wrap(async (req, res) =>
      res.json(await fulfillRequest(db, req.params.id, req.body)),
    ),
  );
  app.post(
    "/api/storefront/requests/:id/reject",
    wrap(async (req, res) =>
      res.json(
        await db.transaction(async () => {
          const request = await getRequest(db, req.params.id);
          if (request.status !== "pending")
            fail("Only pending requests can be rejected", 409);
          await db
            .prepare(
              "UPDATE storefront_requests SET status='rejected',updated_at=? WHERE id=?",
            )
            .run(new Date().toISOString(), request.id);
          await db
            .prepare("INSERT INTO audit(action,detail) VALUES(?,?)")
            .run("storefront.rejected", request.code);
          return { ok: true };
        }),
      ),
    ),
  );
}
module.exports = {
  catalog,
  submit,
  listRequests,
  getRequest,
  processRequest,
  fulfillRequest,
  registerPublic,
  registerPrivate,
};
