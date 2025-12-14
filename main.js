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

// SCOPES
const SCOPES = [
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/drive.metadata'
];

// ---------------------------------------------------------
// 1. AUTHENTICATION LOGIC
// ---------------------------------------------------------

function loadSavedCredentials() {
  if (fs.existsSync(TOKEN_PATH) && fs.existsSync(CREDENTIALS_PATH)) {
    try {
      const tokens = JSON.parse(fs.readFileSync(TOKEN_PATH));
      const keys = require(CREDENTIALS_PATH).web || require(CREDENTIALS_PATH).installed;
      
      const oAuth2Client = new google.auth.OAuth2(
        keys.client_id,
        keys.client_secret,
        'http://localhost:3000/oauth2callback'
      );
      
      oAuth2Client.setCredentials(tokens);
      authClient = oAuth2Client;
      console.log("Auto-login successful from token.json");
      return true;
    } catch (e) {
      console.error("Error loading saved tokens:", e);
      return false;
    }
  }
  return false;
}

async function startAuthentication() {
  console.log("Starting Auth Flow...");
  
  if (!fs.existsSync(CREDENTIALS_PATH)) {
    console.error("ERROR: credentials.json is missing!");
    throw new Error('credentials.json not found');
  }

  const keys = require(CREDENTIALS_PATH).web || require(CREDENTIALS_PATH).installed;
  
  const oAuth2Client = new google.auth.OAuth2(
    keys.client_id,
    keys.client_secret,
    'http://localhost:3000/oauth2callback'
  );

  return new Promise((resolve, reject) => {
    const authorizeUrl = oAuth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: SCOPES,
    });

    const server = http.createServer(async (req, res) => {
      try {
        if (req.url.indexOf('/oauth2callback') > -1) {
          const qs = new url.URL(req.url, 'http://localhost:3000').searchParams;
          const code = qs.get('code');
          
          res.end('<h1>Login Successful!</h1><p>You can close this tab and return to the app.</p>');
          server.close(); 

          console.log("Exchanging code for tokens...");
          const { tokens } = await oAuth2Client.getToken(code);
          oAuth2Client.setCredentials(tokens);
          authClient = oAuth2Client;

          fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens));
          console.log("Token saved to token.json");
          
          resolve(oAuth2Client);
          
          if (win) {
              console.log("Sending success signal to window...");
              win.webContents.send('auth:success');
          }
        }
      } catch (e) {
        console.error("Auth Callback Error:", e);
        reject(e);
      }
    });
    
    server.listen(3000, () => {
      console.log("Opening browser for auth...");
      shell.openExternal(authorizeUrl);
    });
  });
}

// ---------------------------------------------------------
// 2. API HANDLERS
// ---------------------------------------------------------

ipcMain.handle('auth:openWebLogin', async () => {
  try {
    await startAuthentication();
    return true;
  } catch (error) {
    console.error("Auth Failed:", error);
    return false;
  }
});

// A. List Files (Updated with 'parents' field for Drag & Drop)
ipcMain.handle('drive:listFiles', async (event, folderId = 'root') => {
  if (!authClient) loadSavedCredentials();
  if (!authClient) return []; 

  google.options({ auth: authClient });
  const drive = google.drive({ version: 'v3', auth: authClient });

  try {
    const res = await drive.files.list({
      q: `'${folderId}' in parents and trashed = false`,
      pageSize: 100,
      fields: 'files(id, name, mimeType, webViewLink, iconLink, parents)',
      orderBy: 'folder, name', 
      includeItemsFromAllDrives: true,
      supportsAllDrives: true,
    });
    return res.data.files ?? [];
  } catch (err) {
    console.error("Drive List Error:", err);
    return [];
  }
});

// B. Search Files (Updated for Content Search AND Parent Location)
ipcMain.handle('drive:searchFiles', async (event, { query, searchContent }) => {
  if (!authClient) return [];
  const drive = google.drive({ version: 'v3', auth: authClient });
  
  try {
    const qString = searchContent 
      ? `fullText contains '${query}' and trashed = false`
      : `name contains '${query}' and trashed = false`;

    const res = await drive.files.list({
      q: qString,
      pageSize: 20,
      // Added 'parents' so we can open file location
      fields: 'files(id, name, mimeType, webViewLink, iconLink, parents)',
    });
    return res.data.files ?? [];
  } catch (err) { 
    console.error("Search Error:", err);
    return []; 
  }
});

// C. Create File/Folder
ipcMain.handle('drive:createFile', async (event, { parentId, name, mimeType }) => {
  if (!authClient) return null;
  const drive = google.drive({ version: 'v3', auth: authClient });

  try {
    const fileMetadata = {
      name: name,
      parents: [parentId],
      mimeType: mimeType
    };
    
    const file = await drive.files.create({
      resource: fileMetadata,
      fields: 'id, name, mimeType, webViewLink, iconLink'
    });
    
    return file.data;
  } catch (err) {
    console.error("Create Error:", err);
    throw err;
  }
});

// D. Move File (Drag & Drop)
ipcMain.handle('drive:moveFile', async (event, { fileId, oldParentId, newParentId }) => {
  if (!authClient) return false;
  const drive = google.drive({ version: 'v3', auth: authClient });

  try {
    await drive.files.update({
      fileId: fileId,
      addParents: newParentId,
      removeParents: oldParentId,
      fields: 'id, parents'
    });
    return true;
  } catch (err) {
    console.error("Move Error:", err);
    throw err;
  }
});

// E. Get File Details (Versions & Metadata & Parent Name)
ipcMain.handle('drive:getFileDetails', async (event, fileId) => {
  if (!authClient) return null;
  const drive = google.drive({ version: 'v3', auth: authClient });

  try {
    // 1. Get Basic Metadata
    const fileReq = drive.files.get({
      fileId: fileId,
      fields: 'id, name, mimeType, size, createdTime, modifiedTime, owners(displayName, emailAddress), parents'
    });

    // 2. Get Revisions
    let revisions = [];
    try {
        const revRes = await drive.revisions.list({
          fileId: fileId,
          pageSize: 10, 
          fields: 'revisions(id, modifiedTime, lastModifyingUser(displayName), originalFilename)'
        });
        revisions = revRes.data.revisions || [];
    } catch (e) {
        console.log("Could not fetch revisions:", e.message);
    }

    const fileRes = await fileReq;
    const meta = fileRes.data;

    // 3. Fetch Parent Name (For Details view)
    let parentName = 'Root';
    if (meta.parents && meta.parents.length > 0) {
        try {
            const parentRes = await drive.files.get({
                fileId: meta.parents[0],
                fields: 'name'
            });
            parentName = parentRes.data.name;
        } catch (e) { parentName = 'Unknown'; }
    }
    meta.parentName = parentName;

    return {
      metadata: meta,
      revisions: revisions.reverse() 
    };
  } catch (err) {
    console.error("Details Error:", err);
    throw err;
  }
});

// ---------------------------------------------------------
// 3. CONTEXT MENUS (Right Click)
// ---------------------------------------------------------

ipcMain.on('show-context-menu', (event, { name, link, isFolder, id, parentId }) => {
  const template = [];

  // 1. Open File Location (Only if we know the parent)
  if (parentId && parentId !== 'root') {
      template.push({
          label: '📂 Open File Location',
          click: () => {
              const folderUrl = `https://drive.google.com/drive/folders/${parentId}`;
              shell.openExternal(folderUrl);
          }
      });
      template.push({ type: 'separator' });
  }

  // 2. Creation Options (Only for Folders)
  if (isFolder) {
    template.push(
      { label: '📂 New Folder...', click: () => sendAction(event, 'create', { type: 'folder', parentId: id }) },
      { label: '📝 New Google Doc...', click: () => sendAction(event, 'create', { type: 'doc', parentId: id }) },
      { label: '📊 New Google Sheet...', click: () => sendAction(event, 'create', { type: 'sheet', parentId: id }) },
      { type: 'separator' }
    );
  }

  // 3. Open in Browser
  template.push({
    label: `Open "${name}" in Browser`,
    click: () => { if (link) shell.openExternal(link); }
  });

  template.push({ type: 'separator' });

  // 4. View Details
  template.push({
    label: 'ℹ️ View Details & Versions',
    click: () => sendAction(event, 'details', { id, name })
  });

  template.push({ type: 'separator' });

  // 5. Copy Link
  template.push({
    label: isFolder ? 'Copy Folder Link' : 'Copy File Link',
    click: () => { if (link) clipboard.writeText(link); }
  });

  const menu = Menu.buildFromTemplate(template);
  menu.popup({ window: BrowserWindow.fromWebContents(event.sender) });
});

// Helper to send actions back to renderer
function sendAction(event, action, data) {
  event.sender.send('menu-action', { action, data });
}

// Deep Link Menu (Right Pane)
ipcMain.on('show-header-menu', (event, { url, text }) => {
  const template = [{ label: `Copy Link to Header`, click: () => clipboard.writeText(url) }];
  const menu = Menu.buildFromTemplate(template);
  menu.popup({ window: BrowserWindow.fromWebContents(event.sender) });
});

// ---------------------------------------------------------
// 4. WINDOW SETUP
// ---------------------------------------------------------

async function createWindow() {
  loadSavedCredentials();

  win = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
    }
  });

  win.loadFile('index.html');
  win.once('ready-to-show', () => win.show());
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});