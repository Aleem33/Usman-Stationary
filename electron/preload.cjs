const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("desktop", {
  printers: () => ipcRenderer.invoke("printers:list"),
  print: (opts) => ipcRenderer.invoke("document:print", opts),
  whatsapp: (opts) => ipcRenderer.invoke("external:whatsapp", opts),
  checkUpdates: () => ipcRenderer.invoke("updates:check"),
  installUpdate: () => ipcRenderer.invoke("updates:install"),
  onUpdate: (callback) => {
    const listener = (_, value) => callback(value);
    ipcRenderer.on("update-status", listener);
    return () => ipcRenderer.removeListener("update-status", listener);
  },
});
