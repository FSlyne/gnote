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

// A. List Files
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

// B. Search Files
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

// D. Move File
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

// E. Get File Details
// main.js - UPDATED DETAILS HANDLER (With Full Path Calculation)
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

    // 3. CALCULATE FULL PATH (Recursive Loop)
    let pathString = 'Unknown';
    if (meta.parents && meta.parents.length > 0) {
        const pathParts = [];
        let currentParentId = meta.parents[0];
        let safetyCounter = 0;

        // Loop up to 10 levels deep to prevent infinite waits
        while (currentParentId && safetyCounter < 10) {
            try {
                // If we hit the absolute root, stop
                if (currentParentId === 'root') {
                    pathParts.unshift('My Drive');
                    break;
                }

                // Get details of this parent folder
                const folder = await drive.files.get({
                    fileId: currentParentId,
                    fields: 'id, name, parents'
                });

                pathParts.unshift(folder.data.name);
                
                // Move up one level
                if (folder.data.parents && folder.data.parents.length > 0) {
                    currentParentId = folder.data.parents[0];
                } else {
                    currentParentId = null; // No more parents
                }
            } catch (e) {
                console.log("Path error:", e.message);
                break;
            }
            safetyCounter++;
        }
        pathString = pathParts.join(' / ');
    }
    
    meta.fullPath = pathString; // Store it here

    return {
      metadata: meta,
      revisions: revisions.reverse() 
    };
  } catch (err) {
    console.error("Details Error:", err);
    throw err;
  }
});

// F. Get File Comments (THIS WAS MISSING!)
ipcMain.handle('drive:getFileComments', async (event, fileId) => {
  if (!authClient) return [];
  const drive = google.drive({ version: 'v3', auth: authClient });

  try {
    const res = await drive.comments.list({
      fileId: fileId,
      fields: 'comments(id, content, author(displayName), createdTime, replies(id, content, author(displayName), createdTime))',
      pageSize: 100
    });
    return res.data.comments || [];
  } catch (err) {
    console.error("Comments Error:", err);
    return [];
  }
});

// G. Open External Link (THIS WAS MISSING!)
ipcMain.handle('shell:openExternal', (event, url) => {
  shell.openExternal(url);
});

// ---------------------------------------------------------
// 3. CONTEXT MENUS
// ---------------------------------------------------------

ipcMain.on('show-context-menu', (event, { name, link, isFolder, id, parentId }) => {
  const template = [];

  // Open File Location
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

  // Creation Options
  if (isFolder) {
    template.push(
      { label: '📂 New Folder...', click: () => sendAction(event, 'create', { type: 'folder', parentId: id }) },
      { label: '📝 New Google Doc...', click: () => sendAction(event, 'create', { type: 'doc', parentId: id }) },
      { label: '📊 New Google Sheet...', click: () => sendAction(event, 'create', { type: 'sheet', parentId: id }) },
      { type: 'separator' }
    );
  }

// [REPLACED] Old "Open in Browser" -> New "Edit in App"
  template.push({
    label: '✏️ Edit in App',
    click: () => sendAction(event, 'edit', { id, name, link }) 
  });

  // Optional: Keep "Open in Browser" as a backup (just in case)
  template.push({
    label: '🌐 Open in Browser',
    click: () => { if (link) shell.openExternal(link); }
  });

  template.push({ type: 'separator' });

  template.push({ type: 'separator' });

  // View Details
  template.push({
    label: 'ℹ️ View Details & Versions',
    click: () => sendAction(event, 'details', { id, name })
  });

  // View Comments
  template.push({
    label: '💬 View Comments',
    click: () => sendAction(event, 'comments', { id, name })
  });

  template.push({ type: 'separator' });

  // Copy Link
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