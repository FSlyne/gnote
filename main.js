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
  'https://www.googleapis.com/auth/documents.readonly', // <--- NEW
  'https://www.googleapis.com/auth/spreadsheets' // <--- MUST BE HERE
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
// 2. API HANDLERS
// ---------------------------------------------------------

// main.js - Add this new handler

// J. Scan Document Content
ipcMain.handle('doc:scanContent', async (event, fileId) => {
  if (!authClient) return null;
  
  // Use the Docs API (v1)
  const docs = google.docs({ version: 'v1', auth: authClient });

  try {
    const res = await docs.documents.get({ documentId: fileId });
    // We only send back the body content and title to keep it light
    return {
        title: res.data.title,
        content: res.data.body.content
    };
  } catch (err) {
    console.error("Doc Scan Error:", err);
    return null; // Likely not a Google Doc (maybe a Folder or PDF)
  }
});

ipcMain.handle('auth:openWebLogin', async () => {
  try { await startAuthentication(); return true; } catch (e) { return false; }
});

ipcMain.handle('drive:listFiles', async (event, folderId = 'root') => {
  if (!authClient) loadSavedCredentials();
  if (!authClient) return [];
  const drive = google.drive({ version: 'v3', auth: authClient });
  try {
    const res = await drive.files.list({
      q: `'${folderId}' in parents and trashed = false`,
      pageSize: 100,
      fields: 'files(id, name, mimeType, webViewLink, iconLink, parents, shortcutDetails)',
      orderBy: 'folder, name',
      includeItemsFromAllDrives: true, supportsAllDrives: true,
    });
    return res.data.files ?? [];
  } catch (err) { return []; }
});

// main.js - Add this alongside your other ipcMain handlers

// main.js - Updated Sync Handler (New Columns)

ipcMain.handle('sheet:syncData', async (event, { fileId, items }) => {
  if (!authClient) return false;
  const sheets = google.sheets({ version: 'v4', auth: authClient });
  const drive = google.drive({ version: 'v3', auth: authClient });

  console.log(`Syncing ${items.length} items for File ID: ${fileId}`);

  try {
    // 1. Find (or Create) "Master Index" Sheet
    let spreadsheetId;
    const search = await drive.files.list({
      q: "name='Master Index' and mimeType='application/vnd.google-apps.spreadsheet' and 'root' in parents and trashed=false",
      fields: 'files(id)', pageSize: 1
    });

    if (search.data.files.length > 0) {
      spreadsheetId = search.data.files[0].id;
    } else {
      console.log("Creating Master Index...");
      const newSheet = await sheets.spreadsheets.create({
        resource: { properties: { title: 'Master Index' } }
      });
      spreadsheetId = newSheet.data.spreadsheetId;
      
      // NEW HEADER ROW
      await sheets.spreadsheets.values.append({
        spreadsheetId, range: 'Sheet1!A1', valueInputOption: 'USER_ENTERED',
        resource: { values: [['Date Synced', 'File ID', 'Header ID', 'Type', 'Content']] }
      });
    }

    // 2. Format Data for Append
    const timestamp = new Date().toLocaleString();
    const rows = items.map(item => [
      timestamp,
      fileId,          // Just the File Hash (ID)
      item.headerId,   // Just the Header Hash (ID)
      item.type,
      item.text
    ]);

    // 3. Append Rows
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: 'Sheet1!A1',
      valueInputOption: 'USER_ENTERED',
      resource: { values: rows }
    });

    console.log("Sync Complete.");
    return true;
  } catch (err) {
    console.error("Sync Error Details:", err);
    throw err;
  }
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

ipcMain.handle('drive:moveFile', async (event, { fileId, oldParentId, newParentId }) => {
  if (!authClient) return false;
  const drive = google.drive({ version: 'v3', auth: authClient });
  await drive.files.update({ fileId: fileId, addParents: newParentId, removeParents: oldParentId });
  return true;
});

ipcMain.handle('drive:getFileDetails', async (event, fileId) => {
  if (!authClient) return null;
  const drive = google.drive({ version: 'v3', auth: authClient });
  // Get Meta
  const fileReq = drive.files.get({
    fileId: fileId,
    fields: 'id, name, mimeType, webViewLink, size, createdTime, modifiedTime, owners(displayName, emailAddress), parents'
  });
  // Get Revisions
  let revisions = [];
  try {
      const revRes = await drive.revisions.list({ fileId: fileId, pageSize: 10, fields: 'revisions(id, modifiedTime, lastModifyingUser(displayName))' });
      revisions = revRes.data.revisions || [];
  } catch (e) {}

  const meta = (await fileReq).data;
  
  // Calculate Path
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

// DAILY DIARY HANDLER
ipcMain.handle('drive:openDailyDiary', async () => {
    if (!authClient) return null;
    const drive = google.drive({ version: 'v3', auth: authClient });
  
    try {
      const today = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD
      
      // 1. Find/Create "Daily" Folder
      let dailyFolderId;
      const folderRes = await drive.files.list({
        q: "mimeType='application/vnd.google-apps.folder' and name='Daily' and 'root' in parents and trashed=false",
        fields: 'files(id)', pageSize: 1
      });
  
      if (folderRes.data.files.length > 0) {
        dailyFolderId = folderRes.data.files[0].id;
      } else {
        const newFolder = await drive.files.create({
          resource: { name: 'Daily', mimeType: 'application/vnd.google-apps.folder', parents: ['root'] }, fields: 'id'
        });
        dailyFolderId = newFolder.data.id;
      }
  
      // 2. Find/Create Today's File
      let fileToOpen;
      const fileRes = await drive.files.list({
        q: `name='${today}' and '${dailyFolderId}' in parents and trashed=false`,
        fields: 'files(id, name, mimeType, webViewLink, shortcutDetails)', pageSize: 1
      });
  
      if (fileRes.data.files.length > 0) {
        fileToOpen = fileRes.data.files[0];
      } else {
        const newFile = await drive.files.create({
          resource: { name: today, mimeType: 'application/vnd.google-apps.document', parents: [dailyFolderId] },
          fields: 'id, name, mimeType, webViewLink, shortcutDetails'
        });
        fileToOpen = newFile.data;
      }
      return fileToOpen;
    } catch (err) {
      console.error("Daily Diary Error:", err);
      throw err;
    }
  });

  // main.js - Add these handlers

// L. Get All Tags from Master Index
ipcMain.handle('sheet:getAllTags', async () => {
  if (!authClient) return {};
  const sheets = google.sheets({ version: 'v4', auth: authClient });
  const drive = google.drive({ version: 'v3', auth: authClient });

  try {
    // 1. Find the Sheet ID
    const search = await drive.files.list({
      q: "name='Master Index' and mimeType='application/vnd.google-apps.spreadsheet' and 'root' in parents and trashed=false",
      fields: 'files(id)', pageSize: 1
    });
    if (search.data.files.length === 0) return {}; // No index yet
    const spreadsheetId = search.data.files[0].id;

    // 2. Read the whole sheet (Columns B=FileID, D=Type, E=Content)
    // Assuming structure: Date | FileID | HeaderID | Type | Content
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId, range: 'Sheet1!B:E'
    });

    const rows = res.data.values || [];
    const tagMap = {}; // { "#urgent": ["fileId1", "fileId2"] }

    // 3. Process Rows (Skip header)
    rows.slice(1).forEach(row => {
      const fileId = row[0];
      const type = row[2];
      const content = row[3];

      if (type === 'Tag' && content && fileId) {
        if (!tagMap[content]) tagMap[content] = new Set();
        tagMap[content].add(fileId);
      }
    });

    // Convert Sets to Arrays for transport
    for (const tag in tagMap) {
      tagMap[tag] = Array.from(tagMap[tag]);
    }

    return tagMap;
  } catch (err) {
    console.error("Tag Fetch Error:", err);
    return {};
  }
});

// M. Get Specific Files by IDs (For the filtered view)
// main.js - REPLACE the 'drive:getFilesByIds' handler with this:

// M. Get Specific Files by IDs (Corrected: Uses 'get' instead of 'list')
ipcMain.handle('drive:getFilesByIds', async (event, fileIds) => {
  if (!authClient || !fileIds || fileIds.length === 0) return [];
  const drive = google.drive({ version: 'v3', auth: authClient });

  // Safety: Limit to the first 20 files to prevent rate limiting/lag
  const targetIds = [...new Set(fileIds)].slice(0, 20); // Remove duplicates + slice
  
  try {
    // We must fetch each file individually because we can't 'search' by ID
    const promises = targetIds.map(id => 
       drive.files.get({
          fileId: id,
          fields: 'id, name, mimeType, webViewLink, iconLink, shortcutDetails'
       })
       .then(res => res.data)
       .catch(err => {
           console.log(`Could not find file ${id} (might be deleted/no access)`);
           return null; 
       })
    );

    // Wait for all requests to finish
    const results = await Promise.all(promises);
    
    // Filter out any 'null' results (deleted files)
    return results.filter(f => f !== null);

  } catch(e) {
      console.error("Error fetching file batch:", e);
      return [];
  }
});

// main.js - Add this new handler

// N. Get ALL Items (Tasks/Tags) for the Dashboard
ipcMain.handle('sheet:getAllItems', async () => {
  if (!authClient) return [];
  const sheets = google.sheets({ version: 'v4', auth: authClient });
  const drive = google.drive({ version: 'v3', auth: authClient });

  try {
    // 1. Find the Sheet
    const search = await drive.files.list({
      q: "name='Master Index' and mimeType='application/vnd.google-apps.spreadsheet' and 'root' in parents and trashed=false",
      fields: 'files(id)', pageSize: 1
    });
    if (search.data.files.length === 0) return [];
    const spreadsheetId = search.data.files[0].id;

    // 2. Read All Data (A=Date, B=FileID, C=HeaderID, D=Type, E=Content)
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId, range: 'Sheet1!A2:E' // Skip header row
    });

    const rows = res.data.values || [];
    
    // 3. Convert to Objects
    // Row format: [Date, FileID, HeaderID, Type, Content]
    return rows.map(row => ({
        date: row[0],
        fileId: row[1],
        headerId: row[2],
        type: row[3],
        content: row[4]
    })).filter(item => item.content); // Filter out empty rows

  } catch (err) {
    console.error("Dashboard Fetch Error:", err);
    return [];
  }
});

ipcMain.handle('shell:openExternal', (event, url) => shell.openExternal(url));

// ---------------------------------------------------------
// 3. MENUS
// ---------------------------------------------------------
ipcMain.on('show-context-menu', (event, { name, link, isFolder, id, parentId, hasCopiedFile, shortcutDetails }) => {
  const template = [];
  if (parentId && parentId !== 'root') {
      template.push({ label: '📂 Open File Location', click: () => shell.openExternal(`https://drive.google.com/drive/folders/${parentId}`) });
      template.push({ type: 'separator' });
  }
  if (isFolder) {
    template.push(
      { label: '📂 New Folder...', click: () => sendAction(event, 'create', { type: 'folder', parentId: id }) },
      { label: '📝 New Google Doc...', click: () => sendAction(event, 'create', { type: 'doc', parentId: id }) },
      { label: '📊 New Google Sheet...', click: () => sendAction(event, 'create', { type: 'sheet', parentId: id }) },
      { type: 'separator' }
    );
  }
  template.push({ label: '✏️ Edit in App', click: () => sendAction(event, 'edit', { id, name, link, shortcutDetails }) });
  template.push({ label: '🌐 Open in Browser', click: () => { if (link) shell.openExternal(link); } });
  template.push({ type: 'separator' });
  template.push({ label: 'CCc Copy Reference', click: () => sendAction(event, 'copy-ref', { id, name }) });
  if (isFolder && hasCopiedFile) {
      template.push({ label: '🔗 Paste Shortcut', click: () => sendAction(event, 'paste-shortcut', { parentId: id }) });
  }
  template.push({ type: 'separator' });
  template.push({ label: 'ℹ️ View Details & Versions', click: () => sendAction(event, 'details', { id, name }) });
  // Removed "View Comments"

  Menu.buildFromTemplate(template).popup({ window: BrowserWindow.fromWebContents(event.sender) });
});

function sendAction(event, action, data) { event.sender.send('menu-action', { action, data }); }
ipcMain.on('show-header-menu', (event, { url }) => {
  Menu.buildFromTemplate([{ label: `Copy Link to Header`, click: () => clipboard.writeText(url) }]).popup({ window: BrowserWindow.fromWebContents(event.sender) });
});

// ---------------------------------------------------------
// 4. WINDOW
// ---------------------------------------------------------
async function createWindow() {
  loadSavedCredentials();
  win = new BrowserWindow({
    width: 1200, height: 800, show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, webviewTag: true }
  });
  win.loadFile('index.html');
  win.once('ready-to-show', () => win.show());
}
app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });