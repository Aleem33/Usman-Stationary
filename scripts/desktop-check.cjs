const { _electron: electron } = require("@playwright/test");
const fs = require("node:fs");
(async () => {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const packaged = process.argv.includes("--packaged");
  const app = await electron.launch({
    ...(packaged
      ? {
          executablePath: require("node:path").resolve(
            "release/win-unpacked/Usman Stationary.exe",
          ),
          args: [],
        }
      : { args: ["."] }),
    env,
  });
  try {
    const page = await app.firstWindow();
    await page.waitForLoadState("domcontentloaded");
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.evaluate(() =>
      localStorage.setItem("api", "http://127.0.0.1:4000"),
    );
    await page.reload();
    await page.getByLabel("Username", { exact: true }).fill("admin");
    await page
      .getByLabel("Password", { exact: true })
      .fill("local-ui-check-password");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.getByRole("heading", { name: "Business overview" }).waitFor();
    fs.mkdirSync("artifacts", { recursive: true });
    await page.screenshot({ path: "artifacts/desktop.png", fullPage: true });
    const bridge = await page.evaluate(async () => ({
      print: typeof window.desktop.print,
      printers: Array.isArray(await window.desktop.printers()),
      updates: await window.desktop.checkUpdates(),
    }));
    if (!bridge.printers || bridge.print !== "function")
      throw Error("Desktop bridge failed");
    await page
      .locator("nav")
      .getByRole("button", { name: "Items & Stock", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Print barcodes", exact: true })
      .click();
    await page.locator(".barcode-items input").first().check();
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler("document:print");
      ipcMain.handle("document:print", (_, opts) => {
        globalThis.__printHTML = opts.html;
        return { printed: true };
      });
    });
    await page
      .getByRole("button", { name: "Print labels", exact: true })
      .click();
    await page.waitForTimeout(1000);
    const labelHTML = await app.evaluate(() => globalThis.__printHTML || "");
    if (!labelHTML.includes("data:image/png"))
      throw Error("Barcode label was not generated");
    // Test native PDF rendering without opening a printer/save dialog.
    const pdfSize = await app.evaluate(async ({ BrowserWindow }) => {
      const w = new BrowserWindow({
        show: false,
        webPreferences: { sandbox: true, javascript: false },
      });
      try {
        await w.loadURL(
          "data:text/html;charset=utf-8," +
            encodeURIComponent(globalThis.__printHTML),
        );
        return (await w.webContents.printToPDF({ pageSize: "A4" })).length;
      } finally {
        w.destroy();
      }
    });
    if (pdfSize < 1000) throw Error("Native PDF output was empty");
    if (errors.length) throw Error(errors.join("\n"));
    console.log(
      "Desktop check passed: packaged UI login, IPC bridge, printer enumeration and native PDF engine (" +
        pdfSize +
        " bytes).",
    );
  } finally {
    await app.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
