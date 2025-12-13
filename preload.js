// preload.js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  listFiles: (folderId) => ipcRenderer.invoke('drive:listFiles', folderId),
  // NEW: Search function
  searchFiles: (query) => ipcRenderer.invoke('drive:searchFiles', query),
  
  showContextMenu: (data) => ipcRenderer.send('show-context-menu', data),
  showHeaderMenu: (data) => ipcRenderer.send('show-header-menu', data)
});