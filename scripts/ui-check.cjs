const { chromium } = require("@playwright/test");
const fs = require("node:fs");
(async () => {
  const base = "http://127.0.0.1:4000/api";
  let token = "";
  const request = async (route, body) => {
    const r = await fetch(base + route, {
      method: body ? "POST" : "GET",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await r.json();
    if (!r.ok) throw Error(data.error);
    return data;
  };
  const health = await request("/health");
  if (!health.qa)
    throw Error(
      "Refusing to seed a non-QA API. Start an isolated database with QA_MODE=1 first.",
    );
  const auth = await request("/auth", {
    name: "admin",
    password: "local-ui-check-password",
    setup_key: "local-ui-test-only-setup",
  });
  token = auth.token;
  const state = await request("/state");
  if (!state.items.length) {
    const items = [
      ["Dollar Clipper Ballpoint · Blue", "Pens", 18, 30, 240],
      ["A4 Register · 200 pages", "Registers", 180, 240, 28],
      ["Double A A4 Paper · 500 sheets", "Paper", 1050, 1250, 4],
      ["Dux HB Pencil · Pack of 12", "Pencils", 120, 180, 65],
      ["Piano Whiteboard Marker", "Markers", 45, 80, 6],
      ["UHU Glue Stick · 21g", "Adhesives", 160, 220, 18],
      ["Clear Document File · A4", "Files", 35, 60, 3],
      ["Stapler No. 10", "Office supplies", 220, 340, 14],
    ];
    for (let i = 0; i < items.length; i++) {
      const [name, category, cost, price, stock] = items[i];
      await request("/items", {
        name,
        category,
        cost,
        price,
        stock,
        min_stock: 7,
        barcode: "US000" + (i + 1),
      });
    }
    for (const [name, kind, phone] of [
      ["Al-Rehman Book Depot", "customer", "923001234567"],
      ["City School Supplies", "customer", "923211234567"],
      ["National Paper Traders", "supplier", "923451234567"],
    ])
      await request("/parties", {
        name,
        kind,
        phone,
        address: "Lahore, Pakistan",
      });
    for (let i = 0; i < 7; i++) {
      const d = new Date();
      d.setUTCDate(d.getUTCDate() - i);
      await request("/documents", {
        type: "sale",
        date: d.toISOString().slice(0, 10),
        party_id: (i % 2) + 1,
        paid: i % 2 ? 0 : (12 + i * 3) * 30,
        lines: [{ item_id: 1, qty: 12 + i * 3, price: 30 }],
      });
    }
    await request("/documents", {
      type: "expense",
      date: "2026-10-25",
      account: "Cash",
      amount: 3500,
      category: "Utilities",
      notes: "Electricity bill",
    });
  }
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  const page = await browser.newPage({
    viewport: { width: 1480, height: 1020 },
    deviceScaleFactor: 1,
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://127.0.0.1:5173");
  await page.evaluate((t) => sessionStorage.setItem("token", t), token);
  await page.reload();
  await page.getByRole("heading", { name: "Business overview" }).waitFor();
  fs.mkdirSync("artifacts", { recursive: true });
  await page.screenshot({ path: "artifacts/dashboard.png", fullPage: true });
  for (const name of [
    "Sales",
    "Purchases",
    "Items & Stock",
    "Customers & Suppliers",
    "Expenses",
    "Cash & Bank",
    "Reports",
    "Settings",
    "Point of Sale",
  ]) {
    await page
      .locator("nav")
      .getByRole("button", { name, exact: true })
      .click();
    await page.getByRole("heading", { name, exact: true }).waitFor();
  }
  await page
    .getByRole("textbox", { name: "Scan barcode or search items" })
    .fill("US0001");
  await page
    .getByRole("textbox", { name: "Scan barcode or search items" })
    .press("Enter");
  await page.getByRole("button", { name: "Save Sale", exact: true }).click();
  await page.getByRole("heading", { name: /INV-/ }).waitFor();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page
    .locator("nav")
    .getByRole("button", { name: "Reports", exact: true })
    .click();
  await page.getByRole("button", { name: "Sale Report", exact: true }).click();
  await page
    .getByRole("heading", { name: "Sale Report", exact: true })
    .waitFor();
  await page.locator(".report-result tbody tr").first().waitFor();
  await page.screenshot({ path: "artifacts/sale-report.png", fullPage: true });
  if (errors.length) throw Error(errors.join("\n"));
  console.log(
    "UI check passed: dashboard, all navigation, barcode POS checkout, invoice and report rendering.",
  );
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
