// preload.js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Pass folderId to main process
  listFiles: (folderId) => ipcRenderer.invoke('drive:listFiles', folderId)
});