// preload.js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  listFiles: (folderId) => ipcRenderer.invoke('drive:listFiles', folderId),
  // NEW: Expose the context menu trigger
  showContextMenu: (file) => ipcRenderer.send('show-context-menu', file)
});