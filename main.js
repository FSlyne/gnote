// main.js
const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const process = require('process');
const { authenticate } = require('@google-cloud/local-auth');
const { google } = require('googleapis');

// Scopes required for reading file metadata and content
const SCOPES = [
  'https://www.googleapis.com/auth/drive.metadata.readonly',
  'https://www.googleapis.com/auth/drive.readonly' 
];

let win;
let authClient = null;

// Drive readiness gate
let driveReadyResolve, driveReadyReject;
const driveReady = new Promise((resolve, reject) => {
  driveReadyResolve = resolve;
  driveReadyReject = reject;
});

// IPC: List Files (Supports optional folderId for tree navigation)
ipcMain.handle('drive:listFiles', async (event, folderId = 'root') => {
  if (!authClient) {
    try {
      await driveReady;
    } catch (e) {
      throw new Error("Authentication failed");
    }
  }

  // Force global auth options to ensure the token is attached
  google.options({ auth: authClient });
  const drive = google.drive({ version: 'v3', auth: authClient });

  try {
    const res = await drive.files.list({
      // Query: Children of the specific folder ID, not trashed
      q: `'${folderId}' in parents and trashed = false`,
      pageSize: 100,
      fields: 'files(id, name, mimeType, webViewLink, iconLink)',
      // Sort folders to the top, then alphabetically
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

async function createWindow() {
  win = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false, 
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true // ENABLED for viewing Google Docs
    }
  });

  win.loadFile('index.html');

  // Show window immediately
  win.once('ready-to-show', () => {
    win.show();
  });

  // Handle "Open in New Window" events from the WebView
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://accounts.google.com') || url.startsWith('https://docs.google.com')) {
      return { action: 'allow' };
    }
    return { action: 'deny' };
  });

  win.webContents.on('did-attach-webview', (event, webContents) => {
    webContents.setWindowOpenHandler(({ url }) => {
      return { action: 'allow' };
    });
  });

  try {
    // 1. Perform Local Auth
    const localAuth = await authenticate({
      keyfilePath: path.join(__dirname, 'credentials.json'),
      scopes: SCOPES,
    });

    // 2. Rebuild Auth Client (Fix for "Unregistered Caller" error)
    const credentials = require('./credentials.json'); 
    const { client_id, client_secret, redirect_uris } = credentials.installed || credentials.web;

    const oauth2Client = new google.auth.OAuth2(
      client_id,
      client_secret,
      redirect_uris[0]
    );

    oauth2Client.setCredentials(localAuth.credentials);
    authClient = oauth2Client;
    
    console.log("Authentication successful");
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