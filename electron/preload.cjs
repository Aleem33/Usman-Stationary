const { contextBridge, ipcRenderer } = require("electron");
async function invoke(channel, ...args) {
  try {
    return await ipcRenderer.invoke(channel, ...args);
  } catch (error) {
    throw Error(
      error.message.replace(
        /^Error invoking remote method '[^']+': (?:Error: )?/,
        "",
      ),
    );
  }
}
contextBridge.exposeInMainWorld("desktop", {
  printers: () => invoke("printers:list"),
  print: (opts) => invoke("document:print", opts),
  whatsapp: (opts) => invoke("external:whatsapp", opts),
  openStore: () => invoke("external:store"),
  checkUpdates: () => invoke("updates:check"),
  installUpdate: (confirmed = false) =>
    invoke("updates:install", { confirmed }),
  onUpdate: (callback) => {
    const listener = (_, value) => callback(value);
    ipcRenderer.on("update-status", listener);
    return () => ipcRenderer.removeListener("update-status", listener);
  },
});
