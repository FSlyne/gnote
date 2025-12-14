// preload.js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  listFiles: (folderId) => ipcRenderer.invoke('drive:listFiles', folderId),
// preload.js - Update this line
searchFiles: (query, searchContent) => ipcRenderer.invoke('drive:searchFiles', { query, searchContent }),
  createFile: (data) => ipcRenderer.invoke('drive:createFile', data),
  // preload.js - Add this line to your list
  moveFile: (data) => ipcRenderer.invoke('drive:moveFile', data),
  // preload.js
// Add this line to your api object:
getFileDetails: (fileId) => ipcRenderer.invoke('drive:getFileDetails', fileId),
// preload.js - Add these to your 'api' object:
getFileComments: (fileId) => ipcRenderer.invoke('drive:getFileComments', fileId),
openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
  
  // THIS LINE IS REQUIRED FOR THE BUTTON TO WORK:
  openWebLogin: () => ipcRenderer.invoke('auth:openWebLogin'), 

  showContextMenu: (data) => ipcRenderer.send('show-context-menu', data),
  showHeaderMenu: (data) => ipcRenderer.send('show-header-menu', data),
  onMenuAction: (callback) => ipcRenderer.on('menu-action', (event, args) => callback(args)),
  onAuthSuccess: (callback) => ipcRenderer.on('auth:success', () => callback()) 
});