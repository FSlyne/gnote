require('dotenv').config(); // Load environment variables for API Key
const { app, BrowserWindow, ipcMain, shell, Menu, clipboard } = require('electron');
const path = require('path');
const http = require('http');
const url = require('url');
const fs = require('fs');
const { google } = require('googleapis');
const { GoogleGenerativeAI } = require("@google/generative-ai");

// =============================================================================
// 1. CONFIGURATION & GLOBALS
// =============================================================================

let win;
let authClient = null;
const TOKEN_PATH = path.join(__dirname, 'token.json');
const CREDENTIALS_PATH = path.join(__dirname, 'credentials.json');

// Initialize Gemini AI
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY || "");

const SCOPES = [
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/drive.metadata',
  'https://www.googleapis.com/auth/documents',
  'https://www.googleapis.com/auth/spreadsheets'
];

// =============================================================================
// 2. AUTHENTICATION LOGIC
// =============================================================================

function loadSavedCredentials() {
  console.log('Main: Loading credentials...');
  if (!fs.existsSync(CREDENTIALS_PATH)) {
    console.error('Main: credentials.json missing at', CREDENTIALS_PATH);
    return false;
  }
  if (fs.existsSync(TOKEN_PATH)) {
    try {
      const tokens = JSON.parse(fs.readFileSync(TOKEN_PATH));
      const keys = require(CREDENTIALS_PATH).web || require(CREDENTIALS_PATH).installed;
      const oAuth2Client = new google.auth.OAuth2(keys.client_id, keys.client_secret, 'http://localhost:10000/oauth2callback');
      oAuth2Client.setCredentials(tokens);
      authClient = oAuth2Client;
      console.log('Main: Auth client loaded from token.json');
      return true;
    } catch (e) { console.error('Main: Error loading token:', e); return false; }
  }
  console.log('Main: No token.json found.');
  return false;
}

let authServer = null; // Track active server

async function startAuthentication() {
  if (!fs.existsSync(CREDENTIALS_PATH)) throw new Error('credentials.json not found');
  const keys = require(CREDENTIALS_PATH).web || require(CREDENTIALS_PATH).installed;
  const oAuth2Client = new google.auth.OAuth2(keys.client_id, keys.client_secret, 'http://localhost:10000/oauth2callback');

  // Close existing server if any
  if (authServer) {
    console.log('Main: Closing existing auth server...');
    authServer.close();
    authServer = null;
  }

  return new Promise((resolve, reject) => {
    const authorizeUrl = oAuth2Client.generateAuthUrl({ access_type: 'offline', scope: SCOPES });

    // Create new server
    authServer = http.createServer(async (req, res) => {
      if (req.url.indexOf('/oauth2callback') > -1) {
        const qs = new url.URL(req.url, 'http://localhost:10000').searchParams;
        res.end('<h1>Login Successful!</h1><script>window.close();</script>');

        if (authServer) { authServer.close(); authServer = null; }

        try {
          const { tokens } = await oAuth2Client.getToken(qs.get('code'));
          oAuth2Client.setCredentials(tokens);
          authClient = oAuth2Client;
          fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens));
          resolve(oAuth2Client);
          if (win) win.webContents.send('auth:success');
        } catch (err) {
          reject(err);
        }
      }
    });

    // Handle port errors
    authServer.on('error', (e) => {
      if (e.code === 'EADDRINUSE') {
        console.error('Main: Port 10000 in use');
        reject(new Error('Port 10000 is busy. Please close other GNote instances or apps using port 10000.'));
      } else {
        reject(e);
      }
    });

    authServer.listen(10000, () => {
      console.log('Main: Auth server listening on 10000');
      shell.openExternal(authorizeUrl);
    });
  });
}

// =============================================================================
// 3. HELPER FUNCTIONS
// =============================================================================

async function getOrCreateSheetId(sheets, spreadsheetId, title) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const sheet = meta.data.sheets.find(s => s.properties.title === title);

  if (sheet) {
    return sheet.properties.sheetId;
  } else {
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
      resource: {
        requests: [{
          updateSheetProperties: {
            properties: { sheetId: newSheetId, gridProperties: { frozenRowCount: 1 } },
            fields: 'gridProperties.frozenRowCount'
          }
        }]
      }
    });

    return newSheetId;
  }
}

function extractTextFromDoc(docData) {
  let text = "";
  if (!docData.body || !docData.body.content) return text;
  docData.body.content.forEach(elem => {
    if (elem.paragraph) {
      elem.paragraph.elements.forEach(e => {
        if (e.textRun) text += e.textRun.content;
      });
    }
  });
  return text;
}

// =============================================================================
// 4. API HANDLERS (IPC MAIN)
// =============================================================================

// --- A. AI HANDLERS ---

ipcMain.handle('ai:processContent', async (event, { fileId, promptType, userQuery }) => {
  if (!authClient) return { error: "Not authenticated" };

  try {
    // 1. Fetch File Content (Source of Truth)
    const docs = google.docs({ version: 'v1', auth: authClient });
    const docRes = await docs.documents.get({ documentId: fileId });
    const docContent = extractTextFromDoc(docRes.data);

    if (!docContent || docContent.trim().length === 0) {
      throw new Error("Document appears to be empty.");
    }

    // 2. Prepare AI Model
    // defined in .env or default to 2.0 Flash
    const modelName = process.env.GOOGLE_AI_MODEL || "gemini-2.0-flash";
    const model = genAI.getGenerativeModel({
      model: modelName,
      systemInstruction: "You are an intelligent assistant integrated into a Knowledge Management System. Your goal is to be helpful, concise, and accurate based strictly on the provided document context."
    });

    let prompt = "";
    if (promptType === 'summarize') {
      prompt = `Please provide a concise, structured summary of the following document. Highlight key points and any action items.\n\nDocument Content:\n${docContent}`;
    } else if (promptType === 'organize') {
      prompt = `Analyze this content and suggest a logical folder structure or a set of relevant #tags to organize it within a knowledge base:\n\n${docContent}`;
    } else if (promptType === 'ask') {
      prompt = `Answer the following question based ONLY on the provided document context. If the answer is not in the document, state that clearly.\n\nQuestion: ${userQuery}\n\nDocument Context:\n${docContent}`;
    }

    // 3. Generate Content
    const result = await model.generateContent(prompt);
    const response = await result.response;
    return { text: response.text() };

  } catch (err) {
    console.error("AI Processing Error:", err);

    // Handle Quota Exceeded (429)
    if (err.status === 429 || err.message.includes('429') || err.message.includes('Quota exceeded')) {
      // Try to extract time from message "Please retry in 40.24s"
      const match = err.message.match(/retry in (\d+(\.\d+)?)s/);
      const delay = match ? Math.ceil(parseFloat(match[1])) : 60;
      return { error: "QUOTA_EXCEEDED", retryDelay: delay };
    }

    // Return a user-friendly error structure
    return { error: err.message || "An error occurred while processing with AI." };
  }
});

// --- B. SHEETS & SYNC HANDLERS (FIXED) ---

ipcMain.handle('sheet:syncData', async (event, { fileId, items }) => {
  if (!authClient) return false;
  const sheets = google.sheets({ version: 'v4', auth: authClient });
  const drive = google.drive({ version: 'v3', auth: authClient });

  try {
    // 1. Find/Create Master Index
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

    // 2. Process Tasks
    const currentTasks = items.filter(i => i.type.includes('Task')).map(i => ({
      status: i.type.includes('(Done)') ? 'Closed' : 'Open',
      text: i.text,
      headerId: i.headerId || ''
    }));

    if (currentTasks.length > 0) {
      await getOrCreateSheetId(sheets, spreadsheetId, 'Tasks');
      const range = 'Tasks!A:F';

      let allRows = [];
      try {
        const readRes = await sheets.spreadsheets.values.get({ spreadsheetId, range });
        allRows = readRes.data.values || [];
      } catch (e) { }

      const header = (allRows.length > 0) ? allRows[0] : ['Created', 'Closed', 'File ID', 'Header ID', 'Status', 'Content'];
      const otherFileRows = allRows.slice(1).filter(row => row[2] !== fileId);

      // Preserve history for existing rows
      const myOldRows = allRows.slice(1).filter(row => row[2] === fileId);
      const historyMap = new Map();
      myOldRows.forEach(row => {
        const key = row[3] + '|' + row[5];
        historyMap.set(key, { created: row[0], closed: row[1] });
      });

      const newRows = currentTasks.map(task => {
        const key = task.headerId + '|' + task.text;
        const history = historyMap.get(key);
        let created = history ? history.created : nowStr;
        let closed = history ? history.closed : '';
        if (task.status === 'Closed' && !closed) closed = nowStr;
        if (task.status === 'Open') closed = '';
        return [created, closed, fileId, task.headerId, task.status, task.text];
      });

      const finalRows = [header, ...otherFileRows, ...newRows];
      await sheets.spreadsheets.values.clear({ spreadsheetId, range });
      await sheets.spreadsheets.values.update({
        spreadsheetId, range: 'Tasks!A1', valueInputOption: 'USER_ENTERED', resource: { values: finalRows }
      });
    }

    // 3. Process Tags
    const currentTags = items.filter(i => !i.type.includes('Task'));
    if (currentTags.length > 0) {
      await getOrCreateSheetId(sheets, spreadsheetId, 'Tags');
      const tagRange = 'Tags!A:E';
      let allTagRows = [];
      try {
        const tagRead = await sheets.spreadsheets.values.get({ spreadsheetId, range: tagRange });
        allTagRows = tagRead.data.values || [];
      } catch (e) { }

      const tagHeader = (allTagRows.length > 0) ? allTagRows[0] : ['Date Synced', 'File ID', 'Header ID', 'Type', 'Content'];
      const keptTagRows = allTagRows.slice(1).filter(r => r[1] !== fileId);
      const newTagRows = currentTags.map(i => [nowStr, fileId, i.headerId || '', i.type, i.text]);

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
    let res;
    try { res = await sheets.spreadsheets.values.get({ spreadsheetId, range: 'Tasks!A2:F' }); } catch (e) { return []; }

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
    let res;
    try { res = await sheets.spreadsheets.values.get({ spreadsheetId, range: 'Tags!B:E' }); } catch (e) { return {}; }
    const rows = res.data.values || [];
    const tagMap = {};
    rows.slice(1).forEach(row => {
      const fileId = row[0]; const type = row[2]; const content = row[3];
      if (type === 'Tag' && content && fileId) {
        if (!tagMap[content]) tagMap[content] = new Set();
        tagMap[content].add(fileId);
      }
    });
    for (const tag in tagMap) { tagMap[tag] = Array.from(tagMap[tag]); }
    return tagMap;
  } catch (err) { return {}; }
});

// --- C. DRIVE & DOC HANDLERS ---

ipcMain.handle('drive:toggleStar', async (event, { fileId, addStar }) => {
  if (!authClient) return false;
  const drive = google.drive({ version: 'v3', auth: authClient });
  try {
    await drive.files.update({
      fileId: fileId,
      resource: { starred: addStar },
      fields: 'id, starred'
    });
    return true;
  } catch (err) {
    console.error("Star Error:", err);
    throw err;
  }
});

ipcMain.handle('doc:scanContent', async (event, fileId) => {
  if (!authClient) return null;
  const docs = google.docs({ version: 'v1', auth: authClient });
  const drive = google.drive({ version: 'v3', auth: authClient });
  try {
    const docRes = await docs.documents.get({ documentId: fileId });
    let comments = [];
    try {
      const commentRes = await drive.comments.list({
        fileId: fileId, fields: 'comments(content, author(displayName), quotedFileContent)', pageSize: 100
      });
      comments = commentRes.data.comments || [];
    } catch (e) { console.warn(e); }
    return { title: docRes.data.title, doc: docRes.data, comments: comments };
  } catch (err) { return null; }
});

ipcMain.handle('auth:openWebLogin', async () => {
  console.log('Main: Received auth:openWebLogin request');
  try {
    const client = await startAuthentication();
    console.log('Main: Auth flow started successfully');
    return { success: true };
  } catch (e) {
    console.error('Main: Auth flow failed:', e);
    return { success: false, error: e.message };
  }
});

ipcMain.handle('drive:listFiles', async (event, folderId = 'root') => {
  if (!authClient) loadSavedCredentials();
  if (!authClient) return [];
  const drive = google.drive({ version: 'v3', auth: authClient });
  try {
    const res = await drive.files.list({
      q: `'${folderId}' in parents and trashed = false`, pageSize: 100,
      fields: 'files(id, name, mimeType, webViewLink, iconLink, parents, shortcutDetails, appProperties)',
      orderBy: 'folder, name', includeItemsFromAllDrives: true, supportsAllDrives: true,
    });
    return res.data.files ?? [];
  } catch (err) {
    console.error('Main: drive:listFiles error:', err);
    // If auth error, clear authClient
    if (err.message && (err.message.includes('invalid_grant') || err.code === 401)) {
      console.warn('Main: Clearing invalid authClient');
      authClient = null;
    }
    return [];
  }
});

ipcMain.handle('drive:getStarredFiles', async () => {
  if (!authClient) loadSavedCredentials();
  if (!authClient) return [];
  const drive = google.drive({ version: 'v3', auth: authClient });
  try {
    const res = await drive.files.list({
      q: "starred = true and trashed = false",
      pageSize: 50,
      fields: 'files(id, name, mimeType, webViewLink, iconLink, parents, shortcutDetails, appProperties)',
      orderBy: 'folder, name',
      includeItemsFromAllDrives: true,
      supportsAllDrives: true,
    });
    return res.data.files ?? [];
  } catch (err) { return []; }
});

ipcMain.handle('drive:searchFiles', async (event, { query, searchContent }) => {
  if (!authClient) return [];
  const drive = google.drive({ version: 'v3', auth: authClient });
  try {
    const qString = searchContent ? `fullText contains '${query}' and trashed = false` : `name contains '${query}' and trashed = false`;
    const res = await drive.files.list({ q: qString, pageSize: 20, fields: 'files(id, name, mimeType, webViewLink, iconLink, parents, shortcutDetails)' });
    return res.data.files ?? [];
  } catch (err) { return []; }
});

ipcMain.handle('drive:createFile', async (event, { parentId, name, mimeType }) => {
  if (!authClient) return null;
  const drive = google.drive({ version: 'v3', auth: authClient });
  const file = await drive.files.create({
    resource: { name: name, parents: [parentId], mimeType: mimeType }, fields: 'id, name, mimeType, webViewLink, iconLink'
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
      resource: {
        name: name, parents: [parentId], mimeType: 'application/vnd.google-apps.drive-sdk',
        appProperties: { role: 'section_link', sourceFileId: sourceFileId, headerId: headerId },
        description: `Jump link to section in file ID: ${sourceFileId}`
      }, fields: 'id, name, mimeType, webViewLink, iconLink, appProperties'
    });
    return file.data;
  } catch (e) { throw e; }
});

ipcMain.handle('drive:createWebLink', async (event, { parentId, name, url, note, tags }) => {
  if (!authClient) return null;
  const drive = google.drive({ version: 'v3', auth: authClient });
  try {
    const file = await drive.files.create({
      resource: {
        name: name,
        parents: [parentId],
        mimeType: 'application/vnd.google-apps.drive-sdk',
        appProperties: {
          role: 'web_link',
          url: url,
          note: note || '',
          tags: JSON.stringify(tags || [])
        },
        description: `URL: ${url}\n\n${note || ''}` // Helps with search
      },
      fields: 'id, name, mimeType, webViewLink, iconLink, appProperties'
    });
    return file.data;
  } catch (e) { throw e; }
});

ipcMain.handle('drive:updateWebLink', async (event, { fileId, name, url, note, tags }) => {
  if (!authClient) return null;
  const drive = google.drive({ version: 'v3', auth: authClient });
  try {
    const file = await drive.files.update({
      fileId: fileId,
      resource: {
        name: name,
        appProperties: {
          role: 'web_link',
          url: url,
          note: note || '',
          tags: JSON.stringify(tags || [])
        },
        description: `URL: ${url}\n\n${note || ''}`
      },
      fields: 'id, name, mimeType, webViewLink, iconLink, appProperties'
    });
    return file.data;
  } catch (e) { throw e; }
});

ipcMain.handle('drive:moveFile', async (event, { fileId, oldParentId, newParentId }) => {
  if (!authClient) return false;
  const drive = google.drive({ version: 'v3', auth: authClient });
  await drive.files.update({ fileId: fileId, addParents: newParentId, removeParents: oldParentId, fields: 'id, parents' });
  return true;
});

ipcMain.handle('drive:getFileDetails', async (event, fileId) => {
  console.log('Main: getFileDetails (v3-FIXED) invoked for:', fileId);
  if (!authClient) return null;
  const drive = google.drive({ version: 'v3', auth: authClient });
  try {
    const fileReq = drive.files.get({ fileId: fileId, fields: 'id, name, mimeType, description, appProperties, webViewLink, size, createdTime, modifiedTime, owners(displayName, emailAddress), parents' });
    let revisions = [];
    try {
      const revRes = await drive.revisions.list({ fileId: fileId, pageSize: 10, fields: 'revisions(id, modifiedTime, lastModifyingUser(displayName))' });
      revisions = revRes.data.revisions || [];
    } catch (e) { }
    const meta = (await fileReq).data;
    let pathString = 'Unknown';
    let pathIds = [];
    if (meta.parents && meta.parents.length > 0) {
      const pathParts = [];
      let currentParentId = meta.parents[0];
      let safety = 0;
      while (currentParentId && safety < 10) {
        try {
          if (currentParentId === 'root') {
            pathParts.unshift('My Drive');
            pathIds.unshift('root');
            break;
          }
          const folder = await drive.files.get({ fileId: currentParentId, fields: 'id, name, parents' });
          pathParts.unshift(folder.data.name);
          pathIds.unshift(folder.data.id);
          currentParentId = (folder.data.parents && folder.data.parents.length > 0) ? folder.data.parents[0] : null;
        } catch (e) { break; }
        safety++;
      }
      pathString = pathParts.join(' / ');
    }
    meta.fullPath = pathString;
    meta.pathIds = pathIds;
    return { metadata: meta, revisions: revisions.reverse() };
  } catch (err) {
    console.error('getFileDetails Error:', err);
    throw err; // Re-throw to be caught by renderer, but now we log it on backend
  }
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
    const today = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD

    let dailyFolderId;
    const folderRes = await drive.files.list({
      q: "mimeType='application/vnd.google-apps.folder' and name='Daily' and 'root' in parents and trashed=false",
      fields: 'files(id)',
      pageSize: 1
    });

    if (folderRes.data.files.length > 0) {
      dailyFolderId = folderRes.data.files[0].id;
    } else {
      const newFolder = await drive.files.create({
        resource: { name: 'Daily', mimeType: 'application/vnd.google-apps.folder', parents: ['root'] },
        fields: 'id'
      });
      dailyFolderId = newFolder.data.id;
    }

    const fileRes = await drive.files.list({
      q: `name='${today}' and '${dailyFolderId}' in parents and trashed=false`,
      fields: 'files(id, name, mimeType, webViewLink, shortcutDetails)',
      pageSize: 1
    });

    if (fileRes.data.files.length > 0) {
      return fileRes.data.files[0];
    } else {
      let templateId = null;
      try {
        const tplFolderRes = await drive.files.list({
          q: "mimeType='application/vnd.google-apps.folder' and name='Templates' and 'root' in parents and trashed=false",
          fields: 'files(id)',
          pageSize: 1
        });

        if (tplFolderRes.data.files.length > 0) {
          const tplFolderId = tplFolderRes.data.files[0].id;
          const tplFileRes = await drive.files.list({
            q: `name='Daily' and '${tplFolderId}' in parents and mimeType='application/vnd.google-apps.document' and trashed=false`,
            fields: 'files(id)',
            pageSize: 1
          });
          if (tplFileRes.data.files.length > 0) {
            templateId = tplFileRes.data.files[0].id;
          }
        }
      } catch (e) { }

      if (templateId) {
        const copyRes = await drive.files.copy({
          fileId: templateId,
          resource: { name: today, parents: [dailyFolderId] },
          fields: 'id, name, mimeType, webViewLink, shortcutDetails'
        });
        return copyRes.data;
      } else {
        const newFile = await drive.files.create({
          resource: { name: today, mimeType: 'application/vnd.google-apps.document', parents: [dailyFolderId] },
          fields: 'id, name, mimeType, webViewLink, shortcutDetails'
        });
        return newFile.data;
      }
    }
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
  } catch (e) { return []; }
});

ipcMain.handle('shell:openExternal', (event, url) => shell.openExternal(url));

// =============================================================================
// 5. MENUS
// =============================================================================

function sendCommand(action, data = {}) {
  if (win && win.webContents) {
    win.webContents.send('menu-action', { action, ...data });
  }
}

function sendAction(event, action, data) { event.sender.send('menu-action', { action, data }); }

function createApplicationMenu() {
  const template = [
    { role: 'fileMenu' },
    { label: 'Edit', role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { label: 'Task Dashboard', accelerator: 'CmdOrCtrl+D', click: () => sendCommand('toggle-dashboard') },
        { label: 'Toggle Scanner Pane', accelerator: 'CmdOrCtrl+/', click: () => sendCommand('toggle-scanner') },
        { label: 'Show Graph View', accelerator: 'CmdOrCtrl+G', click: () => sendCommand('show-graph') },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Go',
      submenu: [
        { label: 'Today\'s Diary', accelerator: 'CmdOrCtrl+T', click: () => sendCommand('open-today') }
      ]
    },
    { role: 'windowMenu' },
  ];
  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

// CONTEXT MENUS
ipcMain.on('show-context-menu', (event, { name, link, isFolder, id, parentId, clipboardItem, shortcutDetails, appProperties }) => {
  console.log('Main: Context Menu Request:', name, 'Role:', appProperties ? appProperties.role : 'undefined');
  const template = [];
  const isRoot = id === 'root';

  // AI ACTIONS
  if (!isRoot) {
    template.push({
      label: '✨ Summarize with AI',
      click: () => sendAction(event, 'ai-summarize', { id, name, mimeType: 'application/vnd.google-apps.document' })
    });
    template.push({
      label: '🤖 Ask Questions',
      click: () => sendAction(event, 'ai-ask', { id, name })
    });
    template.push({ type: 'separator' });
  }

  // STANDARD ACTIONS
  if (parentId && parentId !== 'root' && !isRoot) {
    template.push({ label: '📂 Open File Location', click: () => shell.openExternal(`https://drive.google.com/drive/folders/${parentId}`) });
    template.push({ type: 'separator' });
  }

  if (isFolder || isRoot) {
    template.push(
      { label: '📂 New Folder...', click: () => sendAction(event, 'create', { type: 'folder', parentId: id }) },
      { label: '📝 New Google Doc...', click: () => sendAction(event, 'create', { type: 'doc', parentId: id }) },
      { label: '📊 New Google Sheet...', click: () => sendAction(event, 'create', { type: 'sheet', parentId: id }) },
      { label: '🔗 New Web Link...', click: () => sendAction(event, 'create-weblink', { parentId: id }) },
      { type: 'separator' }
    );
  }

  if (!isRoot) {
    template.push({
      label: '⭐ Add to Starred',
      click: () => sendAction(event, 'toggle-star', { id, addStar: true })
    });
    template.push({
      label: '☆ Remove from Starred',
      click: () => sendAction(event, 'toggle-star', { id, addStar: false })
    });
    template.push({ type: 'separator' });
    template.push({ label: '✏️ Rename', click: () => sendAction(event, 'rename', { id, name, parentId }) });

    if (appProperties && appProperties.role === 'web_link') {
      template.push({ label: '✏️ Edit Link Details', click: () => sendAction(event, 'edit-weblink', { id, name, appProperties }) });
    } else {
      template.push({ label: 'Edit in App', click: () => sendAction(event, 'edit', { id, name, link, shortcutDetails }) });
    }

    template.push({ label: '🤖 Summarize with AI', click: () => sendAction(event, 'ai-summarize', { id, name, link, isFolder }) });
    template.push({ label: '❓ Ask AI About This', click: () => sendAction(event, 'ai-question', { id, name, link, isFolder }) });
    template.push({ type: 'separator' });
    template.push({ label: '✂️ Cut File/Folder', click: () => sendAction(event, 'cut-item', { id, name, parentId }) });
    template.push({ label: '🔗 Copy Shortcut Ref', click: () => sendAction(event, 'copy-ref', { id, name }) });
  }

  if ((isFolder || isRoot) && clipboardItem) {
    let pasteLabel = '';
    if (clipboardItem.mode === 'move') pasteLabel = `📋 Paste "${clipboardItem.name}" (Move Here)`;
    else if (clipboardItem.mode === 'shortcut') pasteLabel = `🔗 Paste Shortcut to "${clipboardItem.name}"`;
    if (pasteLabel) template.push({ label: pasteLabel, click: () => sendAction(event, 'paste-item', { parentId: id }) });
  }

  if (!isRoot) {
    template.push({ type: 'separator' });
    template.push({ label: 'ℹ️ View Details & Versions', click: () => sendAction(event, 'details', { id, name }) });
  }

  Menu.buildFromTemplate(template).popup({ window: BrowserWindow.fromWebContents(event.sender) });
});

ipcMain.on('show-header-menu', (event, { url }) => {
  Menu.buildFromTemplate([{ label: `Copy Link to Header`, click: () => clipboard.writeText(url) }]).popup({ window: BrowserWindow.fromWebContents(event.sender) });
});

// =============================================================================
// D. INLINE DATABASE ENGINE (Section-Based)
// =============================================================================

function extractText(element) {
  if (element.paragraph) {
    return element.paragraph.elements.map(e => e.textRun ? e.textRun.content : '').join('');
  }
  if (element.content) { // Table Cell
    return element.content.map(e => extractText(e)).join('\n');
  }
  return '';
}

function scanAndParseDoc(doc) {
  const sections = [];
  let currentHeader = { id: 'root', text: 'Root', level: 0 };
  let currentEntry = {
    headerId: 'root', headerText: 'Root',
    properties: {}, tags: [], tasks: [], todos: []
  };

  const flushEntry = () => {
    if (Object.keys(currentEntry.properties).length > 0 ||
      currentEntry.tags.length > 0 ||
      currentEntry.tasks.length > 0 ||
      currentEntry.todos.length > 0) {
      sections.push({ ...currentEntry });
    }
  };

  const traverse = (elements) => {
    if (!elements) return;
    for (const el of elements) {

      // HEADERS
      if (el.paragraph && el.paragraph.paragraphStyle && el.paragraph.paragraphStyle.namedStyleType.includes('HEADING')) {
        flushEntry();
        const style = el.paragraph.paragraphStyle.namedStyleType;
        const level = parseInt(style.replace('HEADING_', ''));
        const text = el.paragraph.elements.map(e => e.textRun ? e.textRun.content : '').join('').trim();
        const id = el.paragraph.paragraphStyle.headingId ? el.paragraph.paragraphStyle.headingId.replace('h.', '') : 'root';

        currentHeader = { id, text, level };
        currentEntry = {
          headerId: id, headerText: text,
          properties: {}, tags: [], tasks: [], todos: []
        };
        continue;
      }

      // TABLE
      if (el.table) {
        // 1. Check for Properties (2 columns)
        if (el.table.columns === 2) {
          const rows = el.table.tableRows;
          const tempProps = {};
          rows.forEach(row => {
            if (row.tableCells.length !== 2) return;
            const key = extractText(row.tableCells[0]).trim();
            const val = extractText(row.tableCells[1]).trim();
            if (key && val && key.length < 50) { // Safety check for key length
              const cleanKey = key.replace(/:$/, '');
              tempProps[cleanKey] = val;
            }
          });
          Object.assign(currentEntry.properties, tempProps);
        }

        // 2. RECURSE into table content to find tasks/tags/nested headers
        el.table.tableRows.forEach(row => {
          row.tableCells.forEach(cell => {
            traverse(cell.content);
          });
        });
        continue;
      }

      // PARAGRAPH CONTENT (Tasks, Tags, Todos)
      if (el.paragraph) {
        const text = extractText(el).trim();
        if (!text) continue;

        // Tasks ([ ] or [x])
        // Check bullet or text pattern
        const isTask = (el.paragraph.bullet) || text.startsWith('[ ]') || text.startsWith('[x]');
        if (isTask) {
          if (text.startsWith('[ ]') || text.startsWith('[x]')) {
            currentEntry.tasks.push({
              text: text.substring(3).trim(),
              completed: text.toLowerCase().startsWith('[x]')
            });
          }
        }

        // Tags
        const tagMatches = text.match(/#\w+/g);
        if (tagMatches) currentEntry.tags.push(...tagMatches);

        // Generic Markers (e.g., todo:, blog:, read:)
        // Capture "Key: Value" but exclude URLs (http:, https:)
        const markerMatch = text.match(/^([a-zA-Z0-9_\-]+):\s*(.+)/);
        if (markerMatch) {
          const label = markerMatch[1].toLowerCase();
          if (!['http', 'https', 'mailto', 'ftp'].includes(label)) {
            // Determine if we should strip the prefix. 
            // For "todo:", users might expect it stripped, but for "blog:", they want context.
            // Let's keep the full text for maximum clarity in a flat list.
            currentEntry.todos.push(text);
          }
        }
      }
    }
  };

  traverse(doc.body.content || []);
  flushEntry(); // Flush last
  return sections;
}


// -----------------------------------------------------------------------------
// HELPER: Parse Web Link (Used by Rebuild and IndexFile)
// -----------------------------------------------------------------------------
function parseWebLink(file) {
  const description = file.description || '';
  const entry = {
    fileId: file.id,
    fileName: file.name,
    headerId: 'root', // Treating whole weblink as one section
    headerText: file.name,
    fileUpdated: file.modifiedTime,
    isWebLink: true,
    properties: {},
    tags: [],
    tasks: [],
    todos: []
  };

  // 1. Tags
  const textMatches = description.match(/#\w+/g);
  if (textMatches) entry.tags.push(...textMatches);

  if (file.appProperties && file.appProperties.tags) {
    try {
      const propTags = JSON.parse(file.appProperties.tags);
      if (Array.isArray(propTags)) entry.tags.push(...propTags);
    } catch (e) { }
  }

  // 2. Tasks & Markers
  const lines = description.split('\n');
  lines.forEach(line => {
    const trimArgs = line.trim();
    if (trimArgs.startsWith('[ ]') || trimArgs.startsWith('[x]')) {
      entry.tasks.push({
        text: trimArgs.substring(3).trim(),
        completed: trimArgs.toLowerCase().startsWith('[x]')
      });
    }

    const markerMatch = trimArgs.match(/^([a-zA-Z0-9_\-]+):\s*(.+)/);
    if (markerMatch) {
      const label = markerMatch[1].toLowerCase();
      if (!['http', 'https', 'mailto', 'ftp'].includes(label)) {
        entry.todos.push(trimArgs);
      }
    }
  });

  if (entry.tags.length > 0 || entry.tasks.length > 0 || entry.todos.length > 0) {
    return [entry];
  }
  return [];
}

ipcMain.handle('drive:rebuildIndex', async (event, folderId = 'root') => {
  if (!authClient) return { success: false, error: 'Auth required' };
  const drive = google.drive({ version: 'v3', auth: authClient });
  const docs = google.docs({ version: 'v1', auth: authClient });

  try {
    const q = "(mimeType = 'application/vnd.google-apps.document' or appProperties has { key='role' and value='web_link' }) and trashed = false";
    let allFiles = [];
    let pageToken = null;
    do {
      const res = await drive.files.list({ q, pageToken, pageSize: 50, fields: 'nextPageToken, files(id, name, mimeType, modifiedTime, description, appProperties)' });
      allFiles.push(...(res.data.files || []));
      pageToken = res.data.nextPageToken;
    } while (pageToken);

    const MAX_SCAN = 30; // Increased
    const filesToScan = allFiles.slice(0, MAX_SCAN);
    const fullIndex = [];

    // Parallel Scanning for Speed
    const scanningPromises = filesToScan.map(async (file) => {
      try {
        if (file.mimeType === 'application/vnd.google-apps.document') {
          const docRes = await docs.documents.get({ documentId: file.id });
          const sections = scanAndParseDoc(docRes.data);
          sections.forEach(sec => {
            sec.fileId = file.id;
            sec.fileName = file.name;
            sec.fileUpdated = file.modifiedTime;
          });
          return sections;
        } else {
          // Web Link
          return parseWebLink(file);
        }
      } catch (e) {
        console.warn(`Failed to scan ${file.name}: ${e.message}`);
        return [];
      }
    });

    const results = await Promise.all(scanningPromises);
    results.forEach(res => fullIndex.push(...res));

    const indexSearch = await drive.files.list({ q: "name = '_gnote_index.json' and trashed = false", fields: 'files(id)' });
    const fileContent = JSON.stringify(fullIndex, null, 2);
    const media = { mimeType: 'application/json', body: fileContent };

    if (indexSearch.data.files.length > 0) {
      await drive.files.update({ fileId: indexSearch.data.files[0].id, media: media });
    } else {
      await drive.files.create({ resource: { name: '_gnote_index.json', parents: ['root'] }, media: media });
    }

    return { success: true, count: fullIndex.length, data: fullIndex };
  } catch (err) {
    console.error('Index Rebuild Failed:', err);
    return { success: false, error: err.message };
  }
});

// SMART SYNC: Update index for a SINGLE file
ipcMain.handle('drive:indexFile', async (event, fileId) => {
  if (!authClient || !fileId) return { success: false, error: 'Invalid Request' };
  const drive = google.drive({ version: 'v3', auth: authClient });
  const docs = google.docs({ version: 'v1', auth: authClient });

  try {
    // 1. Scan the File
    const docFile = await drive.files.get({ fileId: fileId, fields: 'id, name, mimeType, description, appProperties, modifiedTime' }); // Fetch meta
    let newSections = [];

    if (docFile.data.mimeType === 'application/vnd.google-apps.document') {
      const docRes = await docs.documents.get({ documentId: fileId });
      newSections = scanAndParseDoc(docRes.data);
    } else {
      newSections = parseWebLink(docFile.data);
    }
    newSections.forEach(sec => {
      sec.fileId = fileId;
      sec.fileName = docFile.data.name;
      sec.fileUpdated = docFile.data.modifiedTime;
    });

    // 2. Load Existing Index
    let masterIndex = [];
    let indexFileId = null;

    const indexSearch = await drive.files.list({ q: "name = '_gnote_index.json' and trashed = false", fields: 'files(id)', pageSize: 1 });
    if (indexSearch.data.files.length > 0) {
      indexFileId = indexSearch.data.files[0].id;
      const fileData = await drive.files.get({ fileId: indexFileId, alt: 'media' });
      if (Array.isArray(fileData.data)) masterIndex = fileData.data;
    }

    // 3. Merge (Remove old items for this file, add new ones)
    masterIndex = masterIndex.filter(item => item.fileId !== fileId);
    masterIndex.push(...newSections);

    // 4. Save
    const fileContent = JSON.stringify(masterIndex, null, 2);
    const media = { mimeType: 'application/json', body: fileContent };

    if (indexFileId) {
      await drive.files.update({ fileId: indexFileId, media: media });
    } else {
      await drive.files.create({ resource: { name: '_gnote_index.json', parents: ['root'] }, media: media });
    }

    return { success: true, count: newSections.length };

  } catch (err) {
    console.warn(`SmartSync Failed for ${fileId}:`, err.message);
    return { success: false, error: err.message };
  }
});

// LOAD INDEX (Read-Only)
ipcMain.handle('drive:loadIndex', async (event) => {
  if (!authClient) return { success: false, error: 'Auth required' };
  const drive = google.drive({ version: 'v3', auth: authClient });

  try {
    const indexSearch = await drive.files.list({ q: "name = '_gnote_index.json' and trashed = false", fields: 'files(id)', pageSize: 1 });
    if (indexSearch.data.files.length > 0) {
      const fileId = indexSearch.data.files[0].id;
      const fileData = await drive.files.get({ fileId: fileId, alt: 'media' });
      if (Array.isArray(fileData.data)) {
        return { success: true, data: fileData.data };
      }
    }
    return { success: true, data: [] }; // Empty if not found
  } catch (err) {
    console.warn('Load Index Failed:', err.message);
    return { success: false, error: err.message };
  }
});

// GET ALL TAGS (Read from JSON Index)
ipcMain.handle('drive:getAllTags', async (event) => {
  if (!authClient) return {};
  const drive = google.drive({ version: 'v3', auth: authClient });

  try {
    // 1. Load Index
    let masterIndex = [];
    const indexSearch = await drive.files.list({ q: "name = '_gnote_index.json' and trashed = false", fields: 'files(id)', pageSize: 1 });
    if (indexSearch.data.files.length > 0) {
      const fileId = indexSearch.data.files[0].id;
      const fileData = await drive.files.get({ fileId: fileId, alt: 'media' });
      if (Array.isArray(fileData.data)) masterIndex = fileData.data;
    }

    // 2. Aggregate Tags
    const tagMap = {};
    masterIndex.forEach(item => {
      if (item.tags && item.tags.length > 0) {
        item.tags.forEach(tag => {
          if (!tagMap[tag]) tagMap[tag] = [];
          if (!tagMap[tag].includes(item.fileId)) {
            tagMap[tag].push(item.fileId);
          }
        });
      }
    });

    return tagMap;

  } catch (err) {
    console.warn('Get Tags Failed:', err.message);
    return {};
  }
});

// =============================================================================
// 6. INIT & PROTOCOL HANDLER
// =============================================================================

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    // Someone tried to run a second instance, we should focus our window.
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();

      // Check for protocol launch (Windows)
      const urlRaw = commandLine.find(arg => arg.startsWith('gnote://'));
      if (urlRaw) handleProtocolRaw(urlRaw);
    }
  });

  if (process.defaultApp) {
    if (process.argv.length >= 2) {
      app.setAsDefaultProtocolClient('gnote', process.execPath, [path.resolve(process.argv[1])]);
    }
  } else {
    app.setAsDefaultProtocolClient('gnote');
  }

  async function createWindow() {
    loadSavedCredentials();
    createApplicationMenu();
    win = new BrowserWindow({
      width: 1200, height: 800, show: false,
      webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, webviewTag: true }
    });
    win.loadFile('index.html');
    win.once('ready-to-show', () => {
      win.show();
      // Check for startup protocol launch (Windows)
      const urlRaw = process.argv.find(arg => arg.startsWith('gnote://'));
      if (urlRaw) handleProtocolRaw(urlRaw);
    });
  }

  app.whenReady().then(() => {
    createWindow();
    // macOS protocol handler
    app.on('open-url', (event, url) => {
      event.preventDefault();
      handleProtocolRaw(url);
    });
  });

  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
}

function handleProtocolRaw(rawUrl) {
  try {
    // gnote://new?url=...&title=...
    // Format: URL might have custom scheme issues if not careful, but let's parse.
    // On Windows rawUrl might be "gnote://..."
    const u = new url.URL(rawUrl);
    if (u.hostname === 'new' || u.pathname === '//new') { // accepting both formats
      const targetUrl = u.searchParams.get('url');
      const title = u.searchParams.get('title');
      const note = u.searchParams.get('note') || '';

      if (win && win.webContents) {
        win.webContents.send('open-weblink-modal', { url: targetUrl, title, note });
      }
    }
  } catch (e) {
    console.error("Protocol Parse Error:", e);
  }
}
