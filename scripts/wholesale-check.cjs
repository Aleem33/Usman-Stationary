const assert = require("node:assert/strict"),
  { chromium, _electron: electron } = require("@playwright/test"),
  bcrypt = require("bcryptjs");
const { openDatabase } = require("../server/db.cjs"),
  { createApp } = require("../server/app.cjs"),
  { saveItem } = require("../server/domain.cjs"),
  { validateConfig, defaults } = require("../server/store-pricing.cjs"),
  { processRequest, fulfillRequest } = require("../server/storefront.cjs");
(async () => {
  const packaged = process.argv.includes("--packaged");
  let desktop;
  require("node:fs").mkdirSync("artifacts", { recursive: true });
  require("node:fs").writeFileSync(
    "artifacts/quick-order.xlsx",
    require("./xlsx-fixture.cjs")(),
  );
  const db = openDatabase(":memory:");
  db.prepare("INSERT INTO users(id,name,password) VALUES(1,?,?)").run(
    "admin",
    bcrypt.hashSync("abcdef", 4),
  );
  const id = await saveItem(db, {
    name: "Premium Notebook",
    barcode: "00123",
    category: "Notebooks",
    price: 100,
    cost: 40,
    stock: 500,
  });
  await saveItem(db, {
    name: "Blue Ballpoint",
    barcode: "PEN1",
    category: "Writing essentials",
    price: 20,
    cost: 10,
    stock: 100,
  });
  await saveItem(db, {
    name: "Document Folder",
    barcode: "FILE1",
    category: "Office essentials",
    price: 50,
    cost: 25,
    stock: 100,
  });
  const c = validateConfig({
    ...defaults(),
    products: {
      [id]: {
        min_qty: 10,
        pack_size: 10,
        carton_size: 50,
        featured: true,
        new_arrival: true,
        tiers: [
          { min_qty: 10, price: 90 },
          { min_qty: 50, price: 80 },
        ],
      },
    },
    groups: { retailer: { discount: 10, prices: { [id]: 75 } } },
    bulk: { min_total: 5000, percent: 5 },
  });
  db.prepare("INSERT INTO store_settings(id,payload) VALUES(1,?)").run(
    JSON.stringify(c),
  );
  const server = createApp(db).listen(packaged ? 4000 : 0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  try {
    const page = await browser.newPage({
        viewport: { width: 1440, height: 1000 },
      }),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const base = "http://127.0.0.1:" + server.address().port;
    await page.goto(base + "/usmanstationary");
    await page.locator("#featured-products .product").first().waitFor();
    await page.screenshot({
      path: "artifacts/premium-store-desktop.png",
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await page.screenshot({
      path: "artifacts/premium-store-mobile.png",
      fullPage: true,
    });
    await page.locator('[data-view="quick"]').first().click();
    await page
      .locator("#order-file")
      .setInputFiles("artifacts/quick-order.xlsx");
    await page
      .locator("#import-status")
      .filter({ hasText: "1 rows matched" })
      .waitFor();
    assert.equal(
      await page.getByLabel("Quick quantity 00123").inputValue(),
      "20",
    );
    await page
      .getByRole("button", {
        name: "Add selected products to bag",
        exact: true,
      })
      .click();
    assert.equal(
      await page.getByLabel("Quantity for Premium Notebook").inputValue(),
      "20",
    );
    assert.match(await page.locator("#total").textContent(), /1,800/);
    await page
      .getByLabel("Packaging for Premium Notebook", { exact: true })
      .selectOption("carton");
    await page.getByLabel("Quantity for Premium Notebook").fill("2");
    assert.match(await page.locator("#total").textContent(), /7,600/);
    await page.getByLabel("Your name / business").fill("Bulk customer");
    await page.getByLabel("WhatsApp / phone").fill("03001234567");
    await page
      .getByRole("button", { name: "Send order request", exact: true })
      .click();
    await page.getByRole("heading", { name: "Request received" }).waitFor();
    let payload = JSON.parse(
      db.prepare("SELECT payload FROM storefront_requests").get().payload,
    );
    assert.equal(payload.lines[0].qty, 100);
    assert.equal(payload.total, 760000);
    await page.getByRole("button", { name: "Create another request" }).click();
    await page.getByRole("button", { name: "Account", exact: true }).click();
    await page
      .getByRole("button", { name: "Request an account", exact: true })
      .click();
    await page
      .getByLabel("Name / business", { exact: true })
      .fill("Approved retailer");
    await page.getByLabel("Phone", { exact: true }).fill("03007654321");
    await page.getByLabel("Login", { exact: true }).fill("retailer");
    await page.getByLabel("Password", { exact: true }).fill("abcdef");
    await page
      .getByRole("button", { name: "Request account", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Sign in", exact: true })
      .last()
      .waitFor();
    await page.getByLabel("Password", { exact: true }).fill("abcdef");
    await page.locator("#account-submit").click();
    await page.locator("#signed-in").waitFor({ state: "visible" });
    await page.getByRole("button", { name: "Close account" }).click();
    assert.equal(
      await page.locator("#price-label").textContent(),
      "Public prices",
    );
    let owner;
    if (packaged) {
      const env = { ...process.env };
      delete env.ELECTRON_RUN_AS_NODE;
      desktop = await electron.launch({
        executablePath: require("node:path").resolve(
          "release/win-unpacked/Usman Stationary.exe",
        ),
        args: [
          "--user-data-dir=" +
            require("node:fs").mkdtempSync(
              require("node:path").join(
                require("node:os").tmpdir(),
                "usman-wholesale-qa-",
              ),
            ),
        ],
        env,
      });
      owner = await desktop.firstWindow();
      await owner.waitForLoadState("domcontentloaded");
      await owner.evaluate((url) => localStorage.setItem("api", url), base);
      await owner.reload();
    } else {
      owner = await browser.newPage();
      await owner.goto(base);
    }
    await owner.setViewportSize({ width: 1366, height: 900 });
    owner.on("pageerror", (e) => errors.push(e.message));
    await owner.getByLabel("Password", { exact: true }).fill("abcdef");
    await owner.getByRole("button", { name: "Sign in", exact: true }).click();
    await owner
      .locator("nav")
      .getByRole("button", { name: "Settings", exact: true })
      .click();
    await owner
      .getByRole("button", { name: "Manage online store", exact: true })
      .click();
    await owner.getByRole("button", { name: "Customers", exact: true }).click();
    await owner
      .getByLabel("Account status", { exact: true })
      .selectOption("active");
    await owner
      .getByLabel("Price group", { exact: true })
      .selectOption("retailer");
    await owner
      .getByRole("button", { name: "Save customer access", exact: true })
      .click();
    await owner.getByRole("button", { name: "Products", exact: true }).click();
    await owner
      .getByLabel("Choose product", { exact: true })
      .selectOption(String(id));
    assert.equal(
      await owner.getByLabel("Pieces per pack", { exact: true }).inputValue(),
      "10",
    );
    assert.equal(await owner.getByLabel("Tier price 0").inputValue(), "90");
    await owner.getByRole("button", { name: "Branding", exact: true }).click();
    await owner
      .getByLabel("Homepage headline", { exact: true })
      .fill("Stationery for brighter ideas.");
    await owner
      .getByRole("button", { name: "Save store settings", exact: true })
      .click();
    await owner
      .locator(".toast-success")
      .filter({ hasText: "Online store settings saved" })
      .waitFor();
    assert.equal(
      JSON.parse(db.prepare("SELECT payload FROM store_settings").get().payload)
        .headline,
      "Stationery for brighter ideas.",
    );
    await page.reload();
    await page
      .locator("#price-label")
      .filter({ hasText: "Your retailer prices" })
      .waitFor();
    await page.locator('[data-view="catalog"]').first().click();
    await page
      .locator("#products")
      .getByRole("button", { name: "Add Premium Notebook", exact: true })
      .click();
    assert.match(await page.locator("#total").textContent(), /675/);
    await page
      .getByRole("button", { name: "Send order request", exact: true })
      .click();
    await page.getByRole("heading", { name: "Request received" }).waitFor();
    const row = db
        .prepare("SELECT * FROM storefront_requests ORDER BY id DESC LIMIT 1")
        .get(),
      order = await processRequest(db, row.id, {});
    await fulfillRequest(db, row.id, {
      type: "sale",
      date: "2026-10-27",
      party_id: order.party_id,
      paid: 0,
      lines: [{ item_id: id, qty: 10, price: 67.5 }],
    });
    await page.getByRole("button", { name: "Create another request" }).click();
    await page.getByRole("button", { name: "Buy again", exact: true }).click();
    await page.getByRole("button", { name: "Reorder", exact: true }).click();
    assert.equal(
      await page.getByLabel("Quantity for Premium Notebook").inputValue(),
      "10",
    );
    assert.match(await page.locator("#total").textContent(), /675/);
    const before = await page
      .getByLabel("Quantity for Premium Notebook")
      .inputValue();
    await page.locator('[data-view="quick"]').first().click();
    await page.locator("#order-file").setInputFiles({
      name: "bad.csv",
      mimeType: "text/csv",
      buffer: Buffer.from("sku,quantity,unit\nUNKNOWN,1,piece"),
    });
    await page
      .locator("#import-error")
      .filter({ hasText: "unknown or ambiguous" })
      .waitFor();
    assert.equal(
      await page.getByLabel("Quantity for Premium Notebook").inputValue(),
      before,
    );
    assert.deepEqual(errors, []);
    console.log(
      "Premium store passed: mobile/desktop, actual XLSX import, pack/carton prices and MOQ, bulk discount, pending/approved account pricing, safe history/reorder and all-or-nothing import errors.",
    );
  } finally {
    if (desktop) await desktop.close();
    await browser.close();
    await new Promise((r) => server.close(r));
    db.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
