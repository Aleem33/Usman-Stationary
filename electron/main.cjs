const { app, BrowserWindow, ipcMain, shell, dialog } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const { autoUpdater } = require("electron-updater");
let main;
function trusted(event) {
  if (event.sender !== main?.webContents) throw Error("Untrusted IPC sender");
}
app.whenReady().then(() => {
  main = new BrowserWindow({
    width: 1480,
    height: 960,
    minWidth: 1080,
    minHeight: 720,
    title: "Usman Stationary",
    icon: path.join(__dirname, "../assets/icon.png"),
    backgroundColor: "#f6f7fb",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  main.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  main.webContents.on("will-navigate", (e) => e.preventDefault());
  main.loadFile(path.join(__dirname, "../dist/index.html"));
  const update = (message) => main?.webContents.send("update-status", message);
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.on("checking-for-update", () => update("Checking for updates…"));
  autoUpdater.on("update-available", () => update("Downloading update…"));
  autoUpdater.on("update-not-available", () =>
    update("You have the latest version"),
  );
  autoUpdater.on("error", (e) => update("Update check failed: " + e.message));
  autoUpdater.on("update-downloaded", () => {
    update("Update ready — install from Settings");
  });
  ipcMain.handle("updates:check", (event) => {
    trusted(event);
    if (!app.isPackaged) return "Updates are available in the installed app";
    autoUpdater.checkForUpdates().catch((e) => update(e.message));
    return "Checking for updates…";
  });
  let ready = false;
  autoUpdater.on("update-downloaded", () => (ready = true));
  ipcMain.handle("updates:install", async (event) => {
    trusted(event);
    if (!ready) throw Error("No downloaded update");
    const result = await dialog.showMessageBox(main, {
      type: "question",
      buttons: ["Cancel", "Restart and install"],
      message:
        "Restart Usman Stationary to install the update? Save unfinished documents first.",
    });
    if (result.response === 1) autoUpdater.quitAndInstall();
  });
  ipcMain.handle("printers:list", (event) => {
    trusted(event);
    return main.webContents.getPrintersAsync();
  });
  ipcMain.handle("external:whatsapp", (event, { phone, message }) => {
    trusted(event);
    if (
      !/^\d{7,15}$/.test(phone) ||
      typeof message !== "string" ||
      message.length > 5000
    )
      throw Error("Invalid WhatsApp details");
    return shell.openExternal(
      "https://wa.me/" + phone + "?text=" + encodeURIComponent(message),
    );
  });
  ipcMain.handle("document:print", async (event, opts) => {
    trusted(event);
    if (typeof opts.html !== "string" || opts.html.length > 2000000)
      throw Error("Invalid document");
    const printWindow = new BrowserWindow({
      show: false,
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        javascript: false,
      },
    });
    try {
      await printWindow.loadURL(
        "data:text/html;charset=utf-8," + encodeURIComponent(opts.html),
      );
      if (opts.pdf) {
        const result = await dialog.showSaveDialog(main, {
          defaultPath:
            (opts.name || "invoice").replace(/[^a-zA-Z0-9_-]/g, "") + ".pdf",
          filters: [{ name: "PDF", extensions: ["pdf"] }],
        });
        if (result.canceled) return { canceled: true };
        const pdf = await printWindow.webContents.printToPDF({
          printBackground: true,
          preferCSSPageSize: true,
        });
        fs.writeFileSync(result.filePath, pdf);
        return { saved: true, path: result.filePath };
      }
      await new Promise((resolve, reject) =>
        printWindow.webContents.print(
          {
            silent: false,
            printBackground: true,
            deviceName: opts.printer || "",
          },
          (ok, error) =>
            ok ? resolve() : reject(Error(error || "Print canceled")),
        ),
      );
      return { printed: true };
    } finally {
      printWindow.destroy();
    }
  });
  if (app.isPackaged)
    setTimeout(
      () => autoUpdater.checkForUpdates().catch((e) => update(e.message)),
      5000,
    );
});
app.on("window-all-closed", () => app.quit());
