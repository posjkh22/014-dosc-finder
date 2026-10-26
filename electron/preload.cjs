const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld(
  "docsFinder",
  Object.freeze({
    chooseFolder: () => ipcRenderer.invoke("folder:choose"),
    startSearch: (options) => ipcRenderer.invoke("search:start", options),
    cancelSearch: () => ipcRenderer.invoke("search:cancel"),
    openFile: (filePath) => ipcRenderer.invoke("file:open", filePath),
    revealFile: (filePath) => ipcRenderer.invoke("file:reveal", filePath),
    copyPath: (filePath) => ipcRenderer.invoke("file:copy", filePath),
    exportResults: () => ipcRenderer.invoke("results:export"),
    onSearchEvent: (callback) => {
      const listener = (_event, payload) => callback(payload);
      ipcRenderer.on("search:event", listener);
      return () => ipcRenderer.removeListener("search:event", listener);
    },
  }),
);
