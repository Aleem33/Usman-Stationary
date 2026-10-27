const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  crypto = require("node:crypto"),
  bcrypt = require("bcryptjs");
const { openDatabase } = require("../server/db.cjs");
const { createApp } = require("../server/app.cjs");
const { saveItem } = require("../server/domain.cjs");
test("bulk discount rounds in paisa without charging a free line or changing the total", () => {
  const p = require("../server/store-pricing.cjs"),
    c = p.defaults();
  c.bulk = { min_total: 1, percent: 50 };
  const items = [1, 2, 3].map((id) => ({
    id,
    name: "Item " + id,
    barcode: String(id),
    unit: "pcs",
    price: id === 3 ? 0 : 1,
  }));
  const result = p.priceLines(
    items,
    items.map((i) => ({ item_id: i.id, qty: 1 })),
    c,
    null,
    "customer",
  );
  assert.equal(result.total, 1);
  assert.equal(
    result.lines.reduce((n, l) => n + l.discount, 0),
    1,
  );
  assert.ok(result.lines.every((l) => l.total >= 0));
  assert.equal(result.lines[2].discount, 0);
});
test("quantity tiers, packaging, minimums, private rates, bulk discounts and backup preservation", async () => {
  const db = openDatabase(":memory:");
  try {
    await require("./wholesale-cases.cjs")(db);
  } finally {
    db.close();
  }
});
test("customer accounts require owner approval, isolate history and cannot grant admin access", async () => {
  const db = openDatabase(":memory:");
  db.prepare("INSERT INTO users(id,name,password) VALUES(1,?,?)").run(
    "admin",
    bcrypt.hashSync("abcdef", 4),
  );
  const item = await saveItem(db, {
    name: "Private rates",
    barcode: "PRIVATE1",
    price: 100,
    cost: 30,
    stock: 100,
  });
  const server = createApp(db).listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const base = "http://127.0.0.1:" + server.address().port;
  let cookie = "",
    admin = "";
  const req = async (
    path,
    body,
    method = body ? "POST" : "GET",
    owner = false,
  ) => {
    const r = await fetch(base + "/api" + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(owner ? { Authorization: "Bearer " + admin } : { Cookie: cookie }),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return {
      status: r.status,
      data: await r.json(),
      cookie: r.headers.get("set-cookie")?.split(";")[0],
    };
  };
  try {
    admin = (await req("/auth", { name: "admin", password: "abcdef" })).data
      .token;
    const config = (await req("/storefront/config", null, "GET", true)).data;
    config.groups.retailer = { discount: 20, prices: {} };
    assert.equal(
      (await req("/storefront/config", config, "PUT", true)).status,
      200,
    );
    assert.equal(
      (await req("/storefront/config", config, "PUT", true)).status,
      409,
    );
    assert.equal(
      (
        await req("/storefront/account/register", {
          name: "School customer",
          phone: "03001234567",
          login: "schooluser",
          password: "abcdef",
          segment: "retailer",
          status: "active",
        })
      ).status,
      200,
    );
    let c = db.prepare("SELECT * FROM store_customers").get();
    assert.equal(c.status, "pending");
    assert.equal(c.segment, "public");
    assert.ok(!c.password.includes("abcdef"));
    const login = await req("/storefront/account/login", {
      login: "schooluser",
      password: "abcdef",
    });
    assert.equal(login.status, 200);
    cookie = login.cookie;
    assert.ok(cookie.startsWith("usman_store="));
    assert.equal((await req("/storefront/catalog")).data.items[0].price, 10000);
    assert.equal(
      (
        await req(
          "/storefront/customers/" + c.id,
          { status: "active", segment: "retailer" },
          "PUT",
        )
      ).status,
      401,
    );
    assert.equal(
      (
        await req(
          "/storefront/customers/" + c.id,
          { status: "active", segment: "retailer" },
          "PUT",
          true,
        )
      ).status,
      200,
    );
    assert.equal((await req("/storefront/catalog")).data.items[0].price, 8000);
    assert.equal((await req("/storefront/config")).status, 401);
    assert.equal((await req("/storefront/account/orders")).data.length, 0);
    assert.equal(
      (
        await req(
          "/storefront/customers/" + c.id,
          { status: "blocked", segment: "retailer" },
          "PUT",
          true,
        )
      ).status,
      200,
    );
    assert.equal((await req("/storefront/catalog")).data.items[0].price, 10000);
    assert.equal((await req("/storefront/account/orders")).status, 401);
    assert.equal(
      (
        await req("/storefront/account/login", {
          login: "schooluser",
          password: "abcdef",
        })
      ).status,
      401,
    );
  } finally {
    await new Promise((r) => server.close(r));
    db.close();
  }
});
test("CSV import matches exact SKU, preserves leading zeros and rejects incomplete imports", async () => {
  const { csvRows, matchRows } =
    await import("../server/public/order-import.mjs");
  const items = [{ id: 1, barcode: "00123", name: "Notebook, A4" }];
  assert.deepEqual(
    matchRows(csvRows("\uFEFFsku,quantity,unit\r\n00123,2,pack"), items),
    [{ id: 1, qty: 2, package: "pack" }],
  );
  assert.equal(
    matchRows(csvRows('name,qty\n"Notebook, A4",3'), items)[0].id,
    1,
  );
  assert.throws(
    () => matchRows(csvRows("sku,qty\n00123,2\nUNKNOWN,1"), items),
    /Row 3/,
  );
  assert.throws(() => csvRows('sku,qty\n"bad,2'), /Unclosed/);
});
