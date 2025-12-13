const { app, BrowserWindow, ipcMain, shell, Menu, clipboard } = require('electron');
const path = require('path');
const http = require('http'); // Crucial for catching the login
const url = require('url');
const fs = require('fs');
const { google } = require('googleapis');

// GLOBAL VARIABLES
let win;
let authClient = null;
const TOKEN_PATH = path.join(__dirname, 'token.json');
const CREDENTIALS_PATH = path.join(__dirname, 'credentials.json');

// SCOPES: We need full drive access to create/edit files
const SCOPES = [
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/drive.metadata'
];

// ---------------------------------------------------------
// 1. AUTHENTICATION LOGIC (Restored & Robust)
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
    // A. Generate the URL
    const authorizeUrl = oAuth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: SCOPES,
    });

    // B. Start Local Server to catch the callback
    const server = http.createServer(async (req, res) => {
      try {
        if (req.url.indexOf('/oauth2callback') > -1) {
          const qs = new url.URL(req.url, 'http://localhost:3000').searchParams;
          const code = qs.get('code');
          
          res.end('<h1>Login Successful!</h1><p>You can close this tab and return to the app.</p>');
          server.close(); // Stop listening

          // C. Exchange code for tokens
          console.log("Exchanging code for tokens...");
          const { tokens } = await oAuth2Client.getToken(code);
          oAuth2Client.setCredentials(tokens);
          authClient = oAuth2Client;

          // D. Save to disk
          fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens));
          console.log("Token saved to token.json");
          
          resolve(oAuth2Client);
          
          // E. Notify Window
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
    
    // C. Listen on Port 3000
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

ipcMain.handle('drive:listFiles', async (event, folderId = 'root') => {
  if (!authClient) loadSavedCredentials();
  if (!authClient) return []; 

  google.options({ auth: authClient });
  const drive = google.drive({ version: 'v3', auth: authClient });

  try {
    const res = await drive.files.list({
      q: `'${folderId}' in parents and trashed = false`,
      pageSize: 100,
      fields: 'files(id, name, mimeType, webViewLink, iconLink)',
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

ipcMain.handle('drive:searchFiles', async (event, query) => {
  if (!authClient) return [];
  const drive = google.drive({ version: 'v3', auth: authClient });
  try {
    const res = await drive.files.list({
      q: `name contains '${query}' and trashed = false`,
      pageSize: 20,
      fields: 'files(id, name, mimeType, webViewLink, iconLink)',
    });
    return res.data.files ?? [];
  } catch (err) { return []; }
});

// NEW: Create File/Folder Handler
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

// ---------------------------------------------------------
// 3. CONTEXT MENUS (Right Click)
// ---------------------------------------------------------

ipcMain.on('show-context-menu', (event, { name, link, isFolder, id }) => {
  const template = [];

  // Creation Options (Only if it's a folder)
  if (isFolder) {
    template.push(
      { label: '📂 New Folder...', click: () => sendAction(event, 'create', { type: 'folder', parentId: id }) },
      { label: '📝 New Google Doc...', click: () => sendAction(event, 'create', { type: 'doc', parentId: id }) },
      { label: '📊 New Google Sheet...', click: () => sendAction(event, 'create', { type: 'sheet', parentId: id }) },
      { type: 'separator' }
    );
  }

  // Standard Options
  template.push({
    label: `Open "${name}" in Browser`,
    click: () => { if (link) shell.openExternal(link); }
  });

  template.push({ type: 'separator' });

  template.push({
    label: isFolder ? 'Copy Folder Link' : 'Copy File Link',
    click: () => { if (link) clipboard.writeText(link); }
  });

  const menu = Menu.buildFromTemplate(template);
  menu.popup({ window: BrowserWindow.fromWebContents(event.sender) });
});

function sendAction(event, action, data) {
  event.sender.send('menu-action', { action, data });
}

ipcMain.on('show-header-menu', (event, { url, text }) => {
  const template = [{ label: `Copy Link to Header`, click: () => clipboard.writeText(url) }];
  const menu = Menu.buildFromTemplate(template);
  menu.popup({ window: BrowserWindow.fromWebContents(event.sender) });
});

// ---------------------------------------------------------
// 4. WINDOW SETUP
// ---------------------------------------------------------

async function createWindow() {
  // Attempt auto-login on startup
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