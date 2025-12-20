const { app, BrowserWindow, ipcMain, shell, Menu, clipboard } = require('electron');
const path = require('path');
const http = require('http');
const url = require('url');
const fs = require('fs');
const { google } = require('googleapis');

// GLOBAL VARIABLES
let win;
let authClient = null;
const TOKEN_PATH = path.join(__dirname, 'token.json');
const CREDENTIALS_PATH = path.join(__dirname, 'credentials.json');

const SCOPES = [
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/drive.metadata',
  'https://www.googleapis.com/auth/documents',
  'https://www.googleapis.com/auth/spreadsheets'
];

// ---------------------------------------------------------
// 1. AUTHENTICATION
// ---------------------------------------------------------
function loadSavedCredentials() {
  if (fs.existsSync(TOKEN_PATH) && fs.existsSync(CREDENTIALS_PATH)) {
    try {
      const tokens = JSON.parse(fs.readFileSync(TOKEN_PATH));
      const keys = require(CREDENTIALS_PATH).web || require(CREDENTIALS_PATH).installed;
      const oAuth2Client = new google.auth.OAuth2(keys.client_id, keys.client_secret, 'http://localhost:3000/oauth2callback');
      oAuth2Client.setCredentials(tokens);
      authClient = oAuth2Client;
      return true;
    } catch (e) { return false; }
  }
  return false;
}

async function startAuthentication() {
  if (!fs.existsSync(CREDENTIALS_PATH)) throw new Error('credentials.json not found');
  const keys = require(CREDENTIALS_PATH).web || require(CREDENTIALS_PATH).installed;
  const oAuth2Client = new google.auth.OAuth2(keys.client_id, keys.client_secret, 'http://localhost:3000/oauth2callback');

  return new Promise((resolve, reject) => {
    const authorizeUrl = oAuth2Client.generateAuthUrl({ access_type: 'offline', scope: SCOPES });
    const server = http.createServer(async (req, res) => {
      if (req.url.indexOf('/oauth2callback') > -1) {
        const qs = new url.URL(req.url, 'http://localhost:3000').searchParams;
        res.end('<h1>Login Successful!</h1>');
        server.close();
        const { tokens } = await oAuth2Client.getToken(qs.get('code'));
        oAuth2Client.setCredentials(tokens);
        authClient = oAuth2Client;
        fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens));
        resolve(oAuth2Client);
        if (win) win.webContents.send('auth:success');
      }
    });
    server.listen(3000, () => shell.openExternal(authorizeUrl));
  });
}

// ---------------------------------------------------------
// 2. HELPER FUNCTIONS (Sheets)
// ---------------------------------------------------------

async function getOrCreateSheetId(sheets, spreadsheetId, title) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const sheet = meta.data.sheets.find(s => s.properties.title === title);
  
  if (sheet) {
    return sheet.properties.sheetId;
  } else {
    // NEW SCHEMA for Tasks: Created, Closed, FileID, HeaderID, Status, Content
    let headers = ['Date Synced', 'File ID', 'Header ID', 'Type', 'Content'];
    if (title === 'Tasks') {
        headers = ['Created', 'Closed', 'File ID', 'Header ID', 'Status', 'Content'];
    }

    const addRes = await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      resource: { requests: [{ addSheet: { properties: { title } } }] }
    });
    const newSheetId = addRes.data.replies[0].addSheet.properties.sheetId;
    
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${title}!A1`,
      valueInputOption: 'USER_ENTERED',
      resource: { values: [headers] }
    });
    
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      resource: { requests: [{ updateSheetProperties: {
        properties: { sheetId: newSheetId, gridProperties: { frozenRowCount: 1 } },
        fields: 'gridProperties.frozenRowCount'
      }}] }
    });

    return newSheetId;
  }
}

// ---------------------------------------------------------
// 3. API HANDLERS
// ---------------------------------------------------------

// UPDATED: Sync Logic with Smart Merging for Dates
ipcMain.handle('sheet:syncData', async (event, { fileId, items }) => {
  if (!authClient) return false;
  const sheets = google.sheets({ version: 'v4', auth: authClient });
  const drive = google.drive({ version: 'v3', auth: authClient });

  try {
    // 1. Get Spreadsheet
    let spreadsheetId;
    const search = await drive.files.list({
      q: "name='Master Index' and mimeType='application/vnd.google-apps.spreadsheet' and 'root' in parents and trashed=false",
      fields: 'files(id)', pageSize: 1
    });
    if (search.data.files.length > 0) {
      spreadsheetId = search.data.files[0].id;
    } else {
      const newSheet = await sheets.spreadsheets.create({ resource: { properties: { title: 'Master Index' } } });
      spreadsheetId = newSheet.data.spreadsheetId;
    }

    const nowStr = new Date().toLocaleString();

    // --- HANDLE TASKS (Smart Merge) ---
    // Filter input items for tasks
    const currentTasks = items.filter(i => i.type.includes('Task')).map(i => ({
        status: i.type.includes('(Done)') ? 'Closed' : 'Open',
        text: i.text,
        headerId: i.headerId || ''
    }));

    if (currentTasks.length > 0) {
        await getOrCreateSheetId(sheets, spreadsheetId, 'Tasks');
        
        // Read existing rows to preserve history
        const range = 'Tasks!A:F';
        const readRes = await sheets.spreadsheets.values.get({ spreadsheetId, range });
        const allRows = readRes.data.values || [];
        const header = allRows[0] || ['Created', 'Closed', 'File ID', 'Header ID', 'Status', 'Content'];
        
        // Filter out OTHER files (keep them safe)
        // Col Index 2 is File ID in new schema
        const otherFileRows = allRows.slice(1).filter(row => row[2] !== fileId);
        
        // Find existing rows for THIS file to merge data
        const myOldRows = allRows.slice(1).filter(row => row[2] === fileId);
        
        // Map: "HeaderID|Content" -> { Created, Closed }
        const historyMap = new Map();
        myOldRows.forEach(row => {
            const key = row[3] + '|' + row[5];
            historyMap.set(key, { created: row[0], closed: row[1] });
        });

        // Build NEW rows merging history
        const newRows = currentTasks.map(task => {
            const key = task.headerId + '|' + task.text;
            const history = historyMap.get(key);
            
            let created = history ? history.created : nowStr;
            let closed = history ? history.closed : '';

            // Status Change Logic
            if (task.status === 'Closed' && !closed) closed = nowStr;
            if (task.status === 'Open') closed = ''; // Re-opened

            return [created, closed, fileId, task.headerId, task.status, task.text];
        });

        // Write EVERYTHING back
        const finalRows = [header, ...otherFileRows, ...newRows];
        await sheets.spreadsheets.values.clear({ spreadsheetId, range });
        await sheets.spreadsheets.values.update({
            spreadsheetId, range: 'Tasks!A1', valueInputOption: 'USER_ENTERED', resource: { values: finalRows }
        });
    }

    // --- HANDLE TAGS (Simple Replace) ---
    const currentTags = items.filter(i => !i.type.includes('Task'));
    if (currentTags.length > 0) {
        await getOrCreateSheetId(sheets, spreadsheetId, 'Tags');
        const tagRange = 'Tags!A:E';
        const tagRead = await sheets.spreadsheets.values.get({ spreadsheetId, range: tagRange });
        const allTagRows = tagRead.data.values || [];
        const tagHeader = allTagRows[0] || ['Date Synced', 'File ID', 'Header ID', 'Type', 'Content'];
        
        // Keep other files
        const keptTagRows = allTagRows.slice(1).filter(r => r[1] !== fileId);
        
        // Add new tags
        const newTagRows = currentTags.map(i => [nowStr, fileId, i.headerId||'', i.type, i.text]);
        
        const finalTagRows = [tagHeader, ...keptTagRows, ...newTagRows];
        await sheets.spreadsheets.values.clear({ spreadsheetId, range: tagRange });
        await sheets.spreadsheets.values.update({
            spreadsheetId, range: 'Tags!A1', valueInputOption: 'USER_ENTERED', resource: { values: finalTagRows }
        });
    }

    return true;
  } catch (err) {
    console.error("Sync Error Details:", err);
    throw err;
  }
});

// UPDATED: Return Data with New Columns
ipcMain.handle('sheet:getAllItems', async () => {
  if (!authClient) return [];
  const sheets = google.sheets({ version: 'v4', auth: authClient });
  const drive = google.drive({ version: 'v3', auth: authClient });
  try {
    const search = await drive.files.list({
      q: "name='Master Index' and mimeType='application/vnd.google-apps.spreadsheet' and 'root' in parents and trashed=false",
      fields: 'files(id)', pageSize: 1
    });
    if (search.data.files.length === 0) return [];
    
    const spreadsheetId = search.data.files[0].id;
    
    // Read Tasks (A:F)
    // [Created, Closed, File ID, Header ID, Status, Content]
    let res;
    try { res = await sheets.spreadsheets.values.get({ spreadsheetId, range: 'Tasks!A2:F' }); } catch(e) { return []; }

    const rows = res.data.values || [];
    return rows.map(row => ({
        created: row[0],
        closed: row[1],
        fileId: row[2],
        headerId: row[3],
        status: row[4] || 'Open',
        content: row[5]
    })).filter(item => item.content); 
  } catch (err) { return []; }
});

ipcMain.handle('sheet:getAllTags', async () => {
  if (!authClient) return {};
  const sheets = google.sheets({ version: 'v4', auth: authClient });
  const drive = google.drive({ version: 'v3', auth: authClient });
  try {
    const search = await drive.files.list({
      q: "name='Master Index' and mimeType='application/vnd.google-apps.spreadsheet' and 'root' in parents and trashed=false",
      fields: 'files(id)', pageSize: 1
    });
    if (search.data.files.length === 0) return {}; 
    const spreadsheetId = search.data.files[0].id;
    
    // Read Tags
    let res;
    try { res = await sheets.spreadsheets.values.get({ spreadsheetId, range: 'Tags!B:E' }); } catch(e) { return {}; } 

    const rows = res.data.values || [];
    const tagMap = {}; 
    rows.slice(1).forEach(row => { 
      const fileId = row[0];
      const type = row[2];
      const content = row[3];
      if (type === 'Tag' && content && fileId) {
        if (!tagMap[content]) tagMap[content] = new Set();
        tagMap[content].add(fileId);
      }
    });
    for (const tag in tagMap) { tagMap[tag] = Array.from(tagMap[tag]); }
    return tagMap;
  } catch (err) { return {}; }
});


// ... (Keep existing handlers for Doc Scan, Drive operations, etc.) ...
ipcMain.handle('doc:scanContent', async (event, fileId) => {
  if (!authClient) return null;
  const docs = google.docs({ version: 'v1', auth: authClient });
  const drive = google.drive({ version: 'v3', auth: authClient });
  try {
    const docRes = await docs.documents.get({ documentId: fileId });
    let comments = [];
    try {
      const commentRes = await drive.comments.list({
        fileId: fileId,
        fields: 'comments(content, author(displayName), quotedFileContent)',
        pageSize: 100
      });
      comments = commentRes.data.comments || [];
    } catch (e) { console.warn(e); }
    return { title: docRes.data.title, doc: docRes.data, comments: comments };
  } catch (err) { return null; }
});
ipcMain.handle('auth:openWebLogin', async () => { try { await startAuthentication(); return true; } catch (e) { return false; } });
ipcMain.handle('drive:listFiles', async (event, folderId = 'root') => {
  if (!authClient) loadSavedCredentials();
  if (!authClient) return [];
  const drive = google.drive({ version: 'v3', auth: authClient });
  try {
    const res = await drive.files.list({
      q: `'${folderId}' in parents and trashed = false`,
      pageSize: 100,
      fields: 'files(id, name, mimeType, webViewLink, iconLink, parents, shortcutDetails, appProperties)',
      orderBy: 'folder, name',
      includeItemsFromAllDrives: true, supportsAllDrives: true,
    });
    return res.data.files ?? [];
  } catch (err) { return []; }
});
ipcMain.handle('drive:searchFiles', async (event, { query, searchContent }) => {
  if (!authClient) return [];
  const drive = google.drive({ version: 'v3', auth: authClient });
  try {
    const qString = searchContent ? `fullText contains '${query}' and trashed = false` : `name contains '${query}' and trashed = false`;
    const res = await drive.files.list({
      q: qString, pageSize: 20,
      fields: 'files(id, name, mimeType, webViewLink, iconLink, parents, shortcutDetails)',
    });
    return res.data.files ?? [];
  } catch (err) { return []; }
});
ipcMain.handle('drive:createFile', async (event, { parentId, name, mimeType }) => {
  if (!authClient) return null;
  const drive = google.drive({ version: 'v3', auth: authClient });
  const file = await drive.files.create({
    resource: { name: name, parents: [parentId], mimeType: mimeType },
    fields: 'id, name, mimeType, webViewLink, iconLink'
  });
  return file.data;
});
ipcMain.handle('drive:renameFile', async (event, { fileId, newName }) => {
  if (!authClient) return false;
  const drive = google.drive({ version: 'v3', auth: authClient });
  try { await drive.files.update({ fileId: fileId, resource: { name: newName }, fields: 'id, name' }); return true; } catch (e) { throw e; }
});
ipcMain.handle('drive:createSectionLink', async (event, { parentId, name, sourceFileId, headerId }) => {
  if (!authClient) return null;
  const drive = google.drive({ version: 'v3', auth: authClient });
  try {
      const file = await drive.files.create({
        resource: { name: name, parents: [parentId], mimeType: 'application/vnd.google-apps.drive-sdk',
            appProperties: { role: 'section_link', sourceFileId: sourceFileId, headerId: headerId },
            description: `Jump link to section in file ID: ${sourceFileId}`
        }, fields: 'id, name, mimeType, webViewLink, iconLink, appProperties'
      });
      return file.data;
  } catch(e) { throw e; }
});
ipcMain.handle('drive:moveFile', async (event, { fileId, oldParentId, newParentId }) => {
  if (!authClient) return false;
  const drive = google.drive({ version: 'v3', auth: authClient });
  await drive.files.update({ fileId: fileId, addParents: newParentId, removeParents: oldParentId, fields: 'id, parents' });
  return true;
});
ipcMain.handle('drive:getFileDetails', async (event, fileId) => {
  if (!authClient) return null;
  const drive = google.drive({ version: 'v3', auth: authClient });
  const fileReq = drive.files.get({ fileId: fileId, fields: 'id, name, mimeType, webViewLink, size, createdTime, modifiedTime, owners(displayName, emailAddress), parents' });
  let revisions = [];
  try {
    const revRes = await drive.revisions.list({ fileId: fileId, pageSize: 10, fields: 'revisions(id, modifiedTime, lastModifyingUser(displayName))' });
    revisions = revRes.data.revisions || [];
  } catch (e) {}
  const meta = (await fileReq).data;
  let pathString = 'Unknown';
  if (meta.parents && meta.parents.length > 0) {
      const pathParts = [];
      let currentParentId = meta.parents[0];
      let safety = 0;
      while (currentParentId && safety < 10) {
          try {
              if (currentParentId === 'root') { pathParts.unshift('My Drive'); break; }
              const folder = await drive.files.get({ fileId: currentParentId, fields: 'id, name, parents' });
              pathParts.unshift(folder.data.name);
              currentParentId = (folder.data.parents && folder.data.parents.length > 0) ? folder.data.parents[0] : null;
          } catch(e) { break; }
          safety++;
      }
      pathString = pathParts.join(' / ');
  }
  meta.fullPath = pathString;
  return { metadata: meta, revisions: revisions.reverse() };
});
ipcMain.handle('drive:createShortcut', async (event, { targetId, parentId, name }) => {
  if (!authClient) return null;
  const drive = google.drive({ version: 'v3', auth: authClient });
  const res = await drive.files.create({
    resource: { name: name, parents: [parentId], mimeType: 'application/vnd.google-apps.shortcut', shortcutDetails: { targetId: targetId } },
    fields: 'id, name, mimeType, webViewLink, iconLink'
  });
  return res.data;
});
ipcMain.handle('drive:openDailyDiary', async () => {
    if (!authClient) return null;
    const drive = google.drive({ version: 'v3', auth: authClient });
    try {
      const today = new Date().toLocaleDateString('en-CA'); 
      let dailyFolderId;
      const folderRes = await drive.files.list({ q: "mimeType='application/vnd.google-apps.folder' and name='Daily' and 'root' in parents and trashed=false", fields: 'files(id)', pageSize: 1 });
      if (folderRes.data.files.length > 0) { dailyFolderId = folderRes.data.files[0].id; } else {
        const newFolder = await drive.files.create({ resource: { name: 'Daily', mimeType: 'application/vnd.google-apps.folder', parents: ['root'] }, fields: 'id' });
        dailyFolderId = newFolder.data.id;
      }
      let fileToOpen;
      const fileRes = await drive.files.list({ q: `name='${today}' and '${dailyFolderId}' in parents and trashed=false`, fields: 'files(id, name, mimeType, webViewLink, shortcutDetails)', pageSize: 1 });
      if (fileRes.data.files.length > 0) { fileToOpen = fileRes.data.files[0]; } else {
        const newFile = await drive.files.create({ resource: { name: today, mimeType: 'application/vnd.google-apps.document', parents: [dailyFolderId] }, fields: 'id, name, mimeType, webViewLink, shortcutDetails' });
        fileToOpen = newFile.data;
      }
      return fileToOpen;
    } catch (err) { throw err; }
});
ipcMain.handle('drive:getFilesByIds', async (event, fileIds) => {
  if (!authClient || !fileIds || fileIds.length === 0) return [];
  const drive = google.drive({ version: 'v3', auth: authClient });
  const targetIds = [...new Set(fileIds)].slice(0, 20); 
  try {
    const promises = targetIds.map(id => drive.files.get({ fileId: id, fields: 'id, name, mimeType, webViewLink, iconLink, shortcutDetails' }).then(res => res.data).catch(err => null));
    const results = await Promise.all(promises);
    return results.filter(f => f !== null);
  } catch(e) { return []; }
});
ipcMain.handle('shell:openExternal', (event, url) => shell.openExternal(url));
ipcMain.on('show-context-menu', (event, { name, link, isFolder, id, parentId, clipboardItem, shortcutDetails }) => {
  const template = [];
  if (parentId && parentId !== 'root') { template.push({ label: '📂 Open File Location', click: () => shell.openExternal(`https://drive.google.com/drive/folders/${parentId}`) }); template.push({ type: 'separator' }); }
  if (isFolder) {
    template.push(
      { label: '📂 New Folder...', click: () => sendAction(event, 'create', { type: 'folder', parentId: id }) },
      { label: '📝 New Google Doc...', click: () => sendAction(event, 'create', { type: 'doc', parentId: id }) },
      { label: '📊 New Google Sheet...', click: () => sendAction(event, 'create', { type: 'sheet', parentId: id }) },
      { type: 'separator' }
    );
  }
  template.push({ label: '✏️ Rename', click: () => sendAction(event, 'rename', { id, name, parentId }) });
  template.push({ label: 'Edit in App', click: () => sendAction(event, 'edit', { id, name, link, shortcutDetails }) });
  template.push({ label: '🌐 Open in Browser', click: () => { if (link) shell.openExternal(link); } });
  template.push({ type: 'separator' });
  template.push({ label: '✂️ Cut File/Folder', click: () => sendAction(event, 'cut-item', { id, name, parentId }) });
  template.push({ label: '🔗 Copy Shortcut Ref', click: () => sendAction(event, 'copy-ref', { id, name }) });
  if (isFolder && clipboardItem) {
      let pasteLabel = '';
      if (clipboardItem.mode === 'move') pasteLabel = `📋 Paste "${clipboardItem.name}" (Move Here)`;
      else if (clipboardItem.mode === 'shortcut') pasteLabel = `🔗 Paste Shortcut to "${clipboardItem.name}"`;
      if (pasteLabel) { template.push({ label: pasteLabel, click: () => sendAction(event, 'paste-item', { parentId: id }) }); }
  }
  template.push({ type: 'separator' });
  template.push({ label: 'ℹ️ View Details & Versions', click: () => sendAction(event, 'details', { id, name }) });
  Menu.buildFromTemplate(template).popup({ window: BrowserWindow.fromWebContents(event.sender) });
});
function sendAction(event, action, data) { event.sender.send('menu-action', { action, data }); }
ipcMain.on('show-header-menu', (event, { url }) => { Menu.buildFromTemplate([{ label: `Copy Link to Header`, click: () => clipboard.writeText(url) }]).popup({ window: BrowserWindow.fromWebContents(event.sender) }); });
async function createWindow() {
  loadSavedCredentials();
  win = new BrowserWindow({ width: 1200, height: 800, show: false, webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, webviewTag: true } });
  win.loadFile('index.html');
  win.once('ready-to-show', () => win.show());
}
app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });