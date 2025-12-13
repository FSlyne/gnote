// preload.js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  listFiles: (folderId) => ipcRenderer.invoke('drive:listFiles', folderId),
  searchFiles: (query) => ipcRenderer.invoke('drive:searchFiles', query),
  createFile: (data) => ipcRenderer.invoke('drive:createFile', data),
  
  // THIS LINE IS REQUIRED FOR THE BUTTON TO WORK:
  openWebLogin: () => ipcRenderer.invoke('auth:openWebLogin'), 

  showContextMenu: (data) => ipcRenderer.send('show-context-menu', data),
  showHeaderMenu: (data) => ipcRenderer.send('show-header-menu', data),
  onMenuAction: (callback) => ipcRenderer.on('menu-action', (event, args) => callback(args)),
  onAuthSuccess: (callback) => ipcRenderer.on('auth:success', () => callback()) 
});