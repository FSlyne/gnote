// preload.js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  listFiles: (folderId) => ipcRenderer.invoke('drive:listFiles', folderId),
  showContextMenu: (file) => ipcRenderer.send('show-context-menu', file),
  // NEW: Function to show header menu
  showHeaderMenu: (data) => ipcRenderer.send('show-header-menu', data)
});