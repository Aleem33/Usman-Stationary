// Run after npm run build. Uses only an isolated in-memory database.
const assert = require("node:assert/strict");
const { chromium, _electron: electron } = require("@playwright/test");
const bcrypt = require("bcryptjs");
const { openDatabase } = require("../server/db.cjs");
const { createApp } = require("../server/app.cjs");
const { saveItem, post } = require("../server/domain.cjs");

(async () => {
  const db = openDatabase(":memory:");
  const password = bcrypt.hashSync("abcdef", 4);
  db.prepare("INSERT INTO users(id,name,password) VALUES(1,?,?)").run(
    "admin",
    password,
  );
  await saveItem(db, {
    name: "Factory notebook",
    barcode: "0123456789012",
    cost: 10,
    price: 30,
    stock: 20,
  });
  db.prepare(
    "INSERT INTO parties(id,name,kind,phone,address) VALUES(1,?,?,?,?)",
  ).run("Existing party", "both", "923001234567", "Test only");
  const date = new Date().toLocaleDateString("en-CA", {
    timeZone: "Asia/Karachi",
  });
  const originalSale = await post(db, {
    type: "sale",
    date,
    party_id: 1,
    paid: 0,
    lines: [{ item_id: 1, qty: 2, price: 30 }],
  });
  const originalPurchase = await post(db, {
    type: "purchase",
    date,
    party_id: 1,
    paid: 0,
    lines: [{ item_id: 1, qty: 5, price: 10 }],
  });
  const originals = db.prepare("SELECT * FROM documents ORDER BY id").all();
  const server = createApp(db).listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const packaged = process.argv.includes("--packaged");
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const browser = packaged
    ? await electron.launch({
        executablePath: require("node:path").resolve(
          "release/win-unpacked/Usman Stationary.exe",
        ),
        args: [
          "--user-data-dir=" +
            require("node:fs").mkdtempSync(
              require("node:path").join(
                require("node:os").tmpdir(),
                "usman-pos-qa-",
              ),
            ),
        ],
        env,
      })
    : await chromium.launch({ channel: "msedge", headless: true });
  try {
    const page = packaged
      ? await browser.firstWindow()
      : await browser.newPage();
    await page.setViewportSize({ width: 1366, height: 768 });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const local = "http://127.0.0.1:" + server.address().port;
    if (packaged) {
      await page.waitForLoadState("domcontentloaded");
      await page.evaluate((url) => localStorage.setItem("api", url), local);
      await page.reload();
    } else await page.goto(local);
    await page.getByLabel("Password", { exact: true }).fill("abcdef");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page
      .locator("nav")
      .getByRole("button", { name: "Point of Sale", exact: true })
      .click();
    const cart = page.locator(".pos-form");
    await cart.getByLabel("Scan barcode or search items").fill("0123456789012");
    await cart.getByLabel("Scan barcode or search items").press("Enter");
    await cart.getByLabel("Quantity 0", { exact: true }).fill("2");
    await cart.getByLabel("Notes / terms").fill("Keep this unfinished sale");
    await cart
      .getByRole("button", { name: "Add customer", exact: true })
      .click();
    let modal = page.locator(".modal");
    await modal
      .getByLabel("Name", { exact: true })
      .fill("New counter customer");
    await modal
      .getByRole("button", { name: "Save contact", exact: true })
      .click();
    await modal.waitFor({ state: "detached" });
    const newParty = db
      .prepare("SELECT * FROM parties WHERE name=?")
      .get("New counter customer");
    assert.ok(newParty);
    await assert.equal(
      await cart.getByLabel("Customer / party").inputValue(),
      String(newParty.id),
    );
    const draftIntact = async () => {
      assert.equal(
        await cart.getByLabel("Quantity 0", { exact: true }).inputValue(),
        "2",
      );
      assert.equal(
        await cart.getByLabel("Notes / terms").inputValue(),
        "Keep this unfinished sale",
      );
      assert.equal(
        await cart.getByLabel("Customer / party").inputValue(),
        String(newParty.id),
      );
    };
    const open = async (name) => {
      await page
        .getByRole("region", { name: "POS quick actions" })
        .getByRole("button", { name, exact: true })
        .click();
      await modal.waitFor();
    };
    const save = async (type) => {
      await modal
        .getByRole("button", { name: "Save " + type, exact: true })
        .click();
      await modal.locator(".invoice-preview").waitFor();
      await modal.getByRole("button", { name: "Close", exact: true }).click();
      await draftIntact();
    };
    // Cancelling any action also leaves the pending sale unchanged.
    await open("Purchase");
    await modal.getByRole("button", { name: "Close", exact: true }).click();
    await draftIntact();
    for (const type of [
      "Quotation",
      "Sale Order",
      "Purchase Order",
      "Purchase",
    ]) {
      await open(type);
      await modal
        .getByLabel(
          type.startsWith("Purchase") ? "Supplier" : "Customer / party",
        )
        .selectOption("1");
      await modal
        .getByLabel("Scan barcode or search items")
        .fill("0123456789012");
      await modal.getByLabel("Scan barcode or search items").press("Enter");
      if (type === "Purchase")
        assert.equal(
          await modal.getByLabel("Rate 0", { exact: true }).inputValue(),
          "10",
        );
      await save(type);
    }
    for (const [type, original] of [
      ["Sale Return", originalSale],
      ["Purchase Return", originalPurchase],
    ]) {
      await open(type);
      await modal
        .getByLabel("Original invoice")
        .selectOption(String(original.id));
      await modal.getByLabel("Quantity 0", { exact: true }).fill("1");
      await save(type);
    }
    for (const [name, type, amount] of [
      ["Opening balance", "Opening", "1000"],
      ["Receive money", "Receipt", "30"],
      ["Pay supplier", "Payment", "10"],
      ["Cash / bank transfer", "Transfer", "50"],
      ["Record expense", "Expense", "5"],
    ]) {
      await open(name);
      await modal.getByLabel("Amount (PKR)").fill(amount);
      if (["Receipt", "Payment"].includes(type))
        await modal.getByLabel("Customer / party").selectOption("1");
      if (type === "Expense")
        await modal
          .getByLabel("Description / reference")
          .fill("Counter expense");
      await save(type);
    }
    assert.equal(
      db.prepare("SELECT stock FROM items WHERE id=1").get().stock,
      24,
    );
    assert.equal(
      db
        .prepare(
          "SELECT COALESCE(SUM(debit-credit),0) balance FROM ledger WHERE account='Bank'",
        )
        .get().balance,
      5000,
    );
    assert.equal(
      db
        .prepare(
          "SELECT COALESCE(SUM(debit-credit),0) balance FROM ledger WHERE account='Cash'",
        )
        .get().balance,
      93500,
    );
    assert.equal(db.prepare("SELECT COUNT(*) n FROM documents").get().n, 13);
    assert.deepEqual(
      db
        .prepare("SELECT * FROM documents WHERE id IN (?,?) ORDER BY id")
        .all(originalSale.id, originalPurchase.id),
      originals,
    );
    assert.equal(
      db.prepare("SELECT password FROM users WHERE id=1").get().password,
      password,
    );
    assert.equal(
      db
        .prepare(
          "SELECT COUNT(*) n FROM (SELECT document_id FROM ledger GROUP BY document_id HAVING SUM(debit-credit) <> 0)",
        )
        .get().n,
      0,
    );
    await page.screenshot({
      path: packaged
        ? "artifacts/pos-desktop.png"
        : "artifacts/pos-workspace.png",
      fullPage: true,
    });
    await page.setViewportSize({ width: 1000, height: 600 });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    );
    await page
      .getByRole("region", { name: "POS quick actions" })
      .getByRole("button", { name: "Record expense", exact: true })
      .click();
    await modal.getByRole("button", { name: "Close", exact: true }).click();
    await draftIntact();
    await cart.getByRole("button", { name: "Save Sale", exact: true }).click();
    await modal.locator(".invoice-preview").waitFor();
    await modal.getByRole("button", { name: "Close", exact: true }).click();
    assert.equal(
      await cart.getByLabel("Quantity 0", { exact: true }).count(),
      0,
    );
    assert.equal(
      db.prepare("SELECT stock FROM items WHERE id=1").get().stock,
      22,
    );
    assert.equal(
      db
        .prepare(
          "SELECT COUNT(*) n FROM documents WHERE type='sale' AND party_id=?",
        )
        .get(newParty.id).n,
      1,
    );
    assert.deepEqual(errors, []);
    console.log(
      "POS passed: customer auto-selection, all transaction/finance actions, draft preservation, stock/ledger totals, original data and login preserved, responsive layout, final sale checkout.",
    );
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
    db.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
