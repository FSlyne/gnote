const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // DRIVE FILES
  listFiles: (folderId) => ipcRenderer.invoke('drive:listFiles', folderId),
  searchFiles: (query, searchContent) => ipcRenderer.invoke('drive:searchFiles', { query, searchContent }),
  createFile: (data) => ipcRenderer.invoke('drive:createFile', data),
  moveFile: (data) => ipcRenderer.invoke('drive:moveFile', data),
  getFileDetails: (fileId) => ipcRenderer.invoke('drive:getFileDetails', fileId),
  createShortcut: (data) => ipcRenderer.invoke('drive:createShortcut', data),
  
  // DAILY DIARY
  openDailyDiary: () => ipcRenderer.invoke('drive:openDailyDiary'),
  
  // SCANNER & SYNC (These were missing/incomplete)
  scanContent: (fileId) => ipcRenderer.invoke('doc:scanContent', fileId),
  syncToSheet: (data) => ipcRenderer.invoke('sheet:syncData', data),
  
  // SYSTEM / UTILS
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
  openWebLogin: () => ipcRenderer.invoke('auth:openWebLogin'), 

  // MENUS
  showContextMenu: (data) => ipcRenderer.send('show-context-menu', data),
  showHeaderMenu: (data) => ipcRenderer.send('show-header-menu', data),
  onMenuAction: (callback) => ipcRenderer.on('menu-action', (event, args) => callback(args)),
  
  // EVENTS
  onAuthSuccess: (callback) => ipcRenderer.on('auth:success', () => callback()) 
});