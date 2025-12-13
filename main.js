// main.js - WITH COPY LINK OPTION
const { app, BrowserWindow, ipcMain, shell, Menu, clipboard } = require('electron');
const path = require('path');
const process = require('process');
const { authenticate } = require('@google-cloud/local-auth');
const { google } = require('googleapis');

// ... (Rest of your Setup / Auth code remains the same) ...

const SCOPES = [
  'https://www.googleapis.com/auth/drive.metadata.readonly',
  'https://www.googleapis.com/auth/drive.readonly' 
];

let win;
let authClient = null;

let driveReadyResolve, driveReadyReject;
const driveReady = new Promise((resolve, reject) => {
  driveReadyResolve = resolve;
  driveReadyReject = reject;
});

// IPC HANDLER: List Files
ipcMain.handle('drive:listFiles', async (event, folderId = 'root') => {
  if (!authClient) {
    try { await driveReady; } catch (e) { throw new Error("Authentication failed"); }
  }

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
    console.error("Drive API Error:", err);
    throw err;
  }
});

// UPDATED: Context Menu Handler
ipcMain.on('show-context-menu', (event, { name, link, isFolder }) => {
  const template = [
    {
      label: `Open "${name}" in Browser`,
      click: () => {
        if (link) shell.openExternal(link);
      }
    },
    { type: 'separator' },
    {
      label: isFolder ? 'Copy Folder Link' : 'Copy File Link',
      click: () => {
        if (link) clipboard.writeText(link);
      }
    }
  ];
  const menu = Menu.buildFromTemplate(template);
  menu.popup({ window: BrowserWindow.fromWebContents(event.sender) });
});

// NEW: Handle Deep Link from Right Pane (Keep this if you added the previous feature)
ipcMain.on('show-header-menu', (event, { url, text }) => {
  const template = [
    {
      label: `Copy Link to Header: "${text}..."`,
      click: () => { clipboard.writeText(url); }
    }
  ];
  const menu = Menu.buildFromTemplate(template);
  menu.popup({ window: BrowserWindow.fromWebContents(event.sender) });
});

async function createWindow() {
  win = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false, 
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true 
    }
  });

  win.loadFile('index.html');
  win.once('ready-to-show', () => win.show());

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://accounts.google.com') || url.startsWith('https://docs.google.com')) {
      return { action: 'allow' };
    }
    return { action: 'deny' };
  });

  try {
    const localAuth = await authenticate({
      keyfilePath: path.join(__dirname, 'credentials.json'),
      scopes: SCOPES,
    });
    const credentials = require('./credentials.json'); 
    const keys = credentials.installed || credentials.web;
    const oauth2Client = new google.auth.OAuth2(
      keys.client_id, keys.client_secret, keys.redirect_uris[0]
    );
    oauth2Client.setCredentials(localAuth.credentials);
    authClient = oauth2Client;
    driveReadyResolve(true);
  } catch (error) {
    console.error('Login Failed:', error);
    driveReadyReject(error);
  }
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});