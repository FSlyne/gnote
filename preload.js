const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  listFiles: (folderId) => ipcRenderer.invoke('drive:listFiles', folderId),
  showContextMenu: (data) => ipcRenderer.send('show-context-menu', data),
  showHeaderMenu: (data) => ipcRenderer.send('show-header-menu', data)
});