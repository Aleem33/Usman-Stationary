// End-to-end checks against an isolated in-memory store; never uses the live API.
const assert = require("node:assert/strict");
const { chromium, _electron: electron } = require("@playwright/test");
const bcrypt = require("bcryptjs");
const { openDatabase } = require("../server/db.cjs");
const { createApp } = require("../server/app.cjs");
const { saveItem } = require("../server/domain.cjs");
(async () => {
  const packaged = process.argv.includes("--packaged"),
    db = openDatabase(":memory:");
  db.prepare("INSERT INTO users(id,name,password) VALUES(1,?,?)").run(
    "admin",
    bcrypt.hashSync("abcdef", 4),
  );
  db.prepare("INSERT INTO parties(name,kind,phone) VALUES(?,?,?)").run(
    "Existing supplier",
    "supplier",
    "03009999999",
  );
  const names = [
    "Dollar Blue Ballpoint",
    "A4 Notebook",
    "Double A Paper Ream",
    "HB Pencil Pack",
    "UHU Glue Stick",
    "Document File",
  ];
  for (let i = 0; i < names.length; i++)
    await saveItem(db, {
      name: names[i],
      barcode: "012345678900" + i,
      category: i < 3 ? "Office essentials" : "School supplies",
      cost: 10,
      price: 30 + i * 10,
      stock: 50,
    });
  const server = createApp(db).listen(packaged ? 4000 : 0, "127.0.0.1");
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const base = "http://127.0.0.1:" + server.address().port;
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  let desktop;
  try {
    const errors = [],
      page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(base + "/usmanstationary");
    await page
      .getByRole("button", { name: "Add Dollar Blue Ballpoint", exact: true })
      .click();
    await page.getByLabel("Quantity for Dollar Blue Ballpoint").fill("2");
    await page.getByLabel("Your name / business").fill("Online customer");
    await page.getByLabel("WhatsApp / phone").fill("03001234567");
    await page
      .getByLabel("Address", { exact: true })
      .fill("Customer test address");
    await page.screenshot({
      path: "artifacts/storefront-desktop.png",
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      "Mobile catalog must fit the screen",
    );
    await page.screenshot({
      path: "artifacts/storefront-mobile.png",
      fullPage: true,
    });
    let lost = false;
    await page.route("**/api/storefront/requests", async (route) => {
      if (!lost) {
        lost = true;
        await route.fetch();
        await route.fulfill({
          status: 503,
          contentType: "text/html",
          body: "<!doctype html>Temporary proxy error",
        });
      } else await route.continue();
    });
    await page
      .getByRole("button", { name: "Send order request", exact: true })
      .click();
    await page.locator("#form-error").waitFor({ state: "visible" });
    await page
      .getByRole("button", { name: "Send order request", exact: true })
      .click();
    await page.getByRole("heading", { name: "Request received" }).waitFor();
    const customerCode = await page.locator("#reference").textContent();
    assert.equal(
      db.prepare("SELECT COUNT(*) n FROM storefront_requests").get().n,
      1,
      "Lost confirmation retry must not duplicate the request",
    );
    await page.getByRole("button", { name: "Create another request" }).click();
    await page.getByLabel("I am a").selectOption("supplier");
    await page
      .getByRole("button", { name: "Add Dollar Blue Ballpoint", exact: true })
      .click();
    await page.getByLabel("Quantity for Dollar Blue Ballpoint").fill("1.5");
    await page
      .getByLabel("Offered price for Dollar Blue Ballpoint")
      .fill("12.50");
    await page.getByLabel("Your name / business").fill("Online supplier");
    await page.getByLabel("WhatsApp / phone").fill("03007654321");
    await page
      .getByRole("button", { name: "Send supplier offer", exact: true })
      .click();
    await page.getByRole("heading", { name: "Request received" }).waitFor();
    const supplierCode = await page.locator("#reference").textContent();
    assert.equal(db.prepare("SELECT COUNT(*) n FROM documents").get().n, 0);
    assert.equal(
      db.prepare("SELECT stock FROM items WHERE id=1").get().stock,
      50,
    );
    let admin;
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
                "usman-store-qa-",
              ),
            ),
        ],
        env,
      });
      admin = await desktop.firstWindow();
      await admin.waitForLoadState("domcontentloaded");
      await admin.evaluate((url) => localStorage.setItem("api", url), base);
      await admin.reload();
    } else {
      admin = await browser.newPage();
      await admin.goto(base);
    }
    admin.on("pageerror", (error) => errors.push(error.message));
    await admin.setViewportSize({ width: 1366, height: 900 });
    await admin.getByLabel("Password", { exact: true }).fill("abcdef");
    await admin.getByRole("button", { name: "Sign in", exact: true }).click();
    await admin
      .locator("nav")
      .getByRole("button", { name: "Point of Sale", exact: true })
      .click();
    const cart = admin.locator(".pos-form");
    await cart.getByLabel("Scan barcode or search items").fill("0123456789000");
    await cart.getByLabel("Scan barcode or search items").press("Enter");
    await cart.getByLabel("Notes / terms").fill("Keep counter draft");
    const inbox = admin.getByRole("region", {
      name: "Incoming store requests",
    });
    const review = async (code) => {
      await inbox
        .locator("tr")
        .filter({ hasText: code })
        .getByRole("button", { name: "Review request" })
        .click();
    };
    const modal = admin.locator(".modal"),
      requestModal = admin.getByRole("dialog", {
        name: "Review store request",
      });
    await review(customerCode);
    await requestModal
      .getByRole("button", { name: "Accept as sale order", exact: true })
      .click();
    await modal.locator(".invoice-preview").waitFor();
    assert.equal(
      db.prepare("SELECT stock FROM items WHERE id=1").get().stock,
      50,
    );
    await modal
      .getByRole("button", { name: "Use for invoice", exact: true })
      .click();
    await modal.getByRole("button", { name: "Save Sale", exact: true }).click();
    await modal.locator(".invoice-preview").waitFor();
    assert.equal(
      db.prepare("SELECT stock FROM items WHERE id=1").get().stock,
      48,
    );
    await modal.getByRole("button", { name: "Close", exact: true }).click();
    await review(supplierCode);
    await requestModal.getByLabel("Save under contact").selectOption("1");
    await requestModal
      .getByRole("button", { name: "Accept as purchase order", exact: true })
      .click();
    await modal.locator(".invoice-preview").waitFor();
    await modal
      .getByRole("button", { name: "Use for purchase", exact: true })
      .click();
    assert.equal(
      await modal.getByLabel("Rate 0", { exact: true }).inputValue(),
      "12.5",
    );
    await modal.getByLabel("Payment account").selectOption("Bank");
    await modal
      .getByRole("button", { name: "Save Purchase", exact: true })
      .click();
    await modal.locator(".invoice-preview").waitFor();
    await modal.getByRole("button", { name: "Close", exact: true }).click();
    assert.equal(
      db.prepare("SELECT stock FROM items WHERE id=1").get().stock,
      49.5,
    );
    assert.equal(
      db
        .prepare(
          "SELECT SUM(debit-credit) balance FROM ledger WHERE account='Bank'",
        )
        .get().balance,
      -1875,
    );
    assert.equal(
      db.prepare("SELECT COUNT(*) n FROM parties").get().n,
      2,
      "Linking an existing supplier must not create a duplicate contact",
    );
    await inbox.getByLabel("Store request filter").selectOption("all");
    await review(customerCode);
    await requestModal
      .getByRole("button", { name: "View processed transaction", exact: true })
      .click();
    await modal.locator(".invoice-preview").waitFor();
    await modal.getByRole("button", { name: "Close", exact: true }).click();
    assert.equal(db.prepare("SELECT COUNT(*) n FROM documents").get().n, 4);
    assert.equal(
      db.prepare("SELECT SUM(debit-credit) balance FROM ledger").get().balance,
      0,
    );
    assert.equal(
      await cart.getByLabel("Notes / terms").inputValue(),
      "Keep counter draft",
    );
    assert.equal(
      await cart.getByLabel("Quantity 0", { exact: true }).inputValue(),
      "1",
    );
    await page.getByRole("button", { name: "Create another request" }).click();
    await page
      .getByRole("button", { name: "Add A4 Notebook", exact: true })
      .click();
    await page.getByLabel("Your name / business").fill("Request to reject");
    await page.getByLabel("WhatsApp / phone").fill("03001111111");
    await page
      .getByRole("button", { name: "Send order request", exact: true })
      .click();
    await page.getByRole("heading", { name: "Request received" }).waitFor();
    const rejectedCode = await page.locator("#reference").textContent();
    await inbox
      .getByRole("button", { name: "Refresh requests", exact: true })
      .click();
    await review(rejectedCode);
    await requestModal
      .getByRole("button", { name: "Reject request", exact: true })
      .click();
    await requestModal
      .getByRole("button", { name: "Confirm rejection", exact: true })
      .click();
    await requestModal.waitFor({ state: "detached" });
    assert.equal(
      db
        .prepare("SELECT status FROM storefront_requests WHERE code=?")
        .get(rejectedCode).status,
      "rejected",
    );
    assert.equal(db.prepare("SELECT COUNT(*) n FROM documents").get().n, 4);
    await admin.screenshot({
      path: packaged
        ? "artifacts/storefront-pos-electron.png"
        : "artifacts/storefront-pos.png",
      fullPage: true,
    });
    assert.deepEqual(errors, []);
    console.log(
      "Storefront passed: mobile/desktop catalog, customer request, supplier offered prices, lost-response retry without duplicates, POS review/accept/fulfill, existing contact matching, stock/bank/ledger totals, and preserved counter draft.",
    );
  } finally {
    if (desktop) await desktop.close();
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
    db.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
