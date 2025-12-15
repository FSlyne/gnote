const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  listFiles: (folderId) => ipcRenderer.invoke('drive:listFiles', folderId),
  searchFiles: (query, searchContent) => ipcRenderer.invoke('drive:searchFiles', { query, searchContent }),
  createFile: (data) => ipcRenderer.invoke('drive:createFile', data),
  moveFile: (data) => ipcRenderer.invoke('drive:moveFile', data),
  getFileDetails: (fileId) => ipcRenderer.invoke('drive:getFileDetails', fileId),
  getFileComments: (fileId) => ipcRenderer.invoke('drive:getFileComments', fileId),
  createShortcut: (data) => ipcRenderer.invoke('drive:createShortcut', data),
  openDailyDiary: () => ipcRenderer.invoke('drive:openDailyDiary'), // <--- NEW
  
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
  openWebLogin: () => ipcRenderer.invoke('auth:openWebLogin'), 

  showContextMenu: (data) => ipcRenderer.send('show-context-menu', data),
  showHeaderMenu: (data) => ipcRenderer.send('show-header-menu', data),
  onMenuAction: (callback) => ipcRenderer.on('menu-action', (event, args) => callback(args)),
  onAuthSuccess: (callback) => ipcRenderer.on('auth:success', () => callback()) 
});