const { contextBridge, ipcRenderer } = require('electron');

// marked v17 is ESM-only; guard the require to avoid preload crashing if unavailable
let marked = null;
try {
  // eslint-disable-next-line global-require
  marked = require('marked');
} catch (e) {
  console.warn('Markdown parser (marked) not loaded in preload:', e.message);
}

contextBridge.exposeInMainWorld('api', {
  // =================================================================
  // EXISTING DRIVE & FILE SYSTEM API
  // =================================================================
  listFiles: (folderId) => ipcRenderer.invoke('drive:listFiles', folderId),
  searchFiles: (query, searchContent) => ipcRenderer.invoke('drive:searchFiles', { query, searchContent }),
  getStarredFiles: () => ipcRenderer.invoke('drive:getStarredFiles'),
  toggleStar: (data) => ipcRenderer.invoke('drive:toggleStar', data),
  createFile: (data) => ipcRenderer.invoke('drive:createFile', data),
  moveFile: (data) => ipcRenderer.invoke('drive:moveFile', data),
  renameFile: (data) => ipcRenderer.invoke('drive:renameFile', data),
  createSectionLink: (data) => ipcRenderer.invoke('drive:createSectionLink', data),
  getFileDetails: (fileId) => ipcRenderer.invoke('drive:getFileDetails', fileId),
  createShortcut: (data) => ipcRenderer.invoke('drive:createShortcut', data),
  getFilesByIds: (ids) => ipcRenderer.invoke('drive:getFilesByIds', ids),

  // =================================================================
  // DAILY DIARY
  // =================================================================
  openDailyDiary: () => ipcRenderer.invoke('drive:openDailyDiary'),

  // =================================================================
  // SCANNER & SYNC
  // =================================================================
  scanContent: (fileId) => ipcRenderer.invoke('doc:scanContent', fileId),
  syncToSheet: (data) => ipcRenderer.invoke('sheet:syncData', data),
  getAllTags: () => ipcRenderer.invoke('sheet:getAllTags'),
  getAllItems: () => ipcRenderer.invoke('sheet:getAllItems'),

  // =================================================================
  // AI & FORMATTING (NEW)
  // =================================================================
  processWithAI: (data) => ipcRenderer.invoke('ai:processContent', data),

  // This safely converts Markdown to HTML for the renderer
  parseMarkdown: (text) => {
    if (!marked) return text; // Fallback if marked didn't load
    if (typeof marked.parse === 'function') {
      return marked.parse(text);
    } else if (typeof marked === 'function') {
      return marked(text);
    }
    return text;
  },

  // =================================================================
  // SYSTEM / UTILS
  // =================================================================
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
  openWebLogin: () => ipcRenderer.invoke('auth:openWebLogin'),

  // =================================================================
  // MENUS
  // =================================================================
  showContextMenu: (data) => ipcRenderer.send('show-context-menu', data),
  showHeaderMenu: (data) => ipcRenderer.send('show-header-menu', data),
  onMenuAction: (callback) => ipcRenderer.on('menu-action', (event, args) => callback(args)),

  // =================================================================
  // EVENTS
  // =================================================================
  onAuthSuccess: (callback) => ipcRenderer.on('auth:success', () => callback())
});
