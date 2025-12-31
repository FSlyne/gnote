# GNote Technical Specification & Rebuild Guide

**Version:** 1.0
**Purpose:** Defines the architecture, data models, and logic required to rebuild the GNote system from scratch.

---

## 1. Project Setup
### 1.1. Core Stack
- **Runtime:** Node.js (v16+)
- **Framework:** Electron (v33+)
- **Google Client:** `googleapis` (v126+)

### 1.2. Directory Structure
```
gnote/
├── main.js           # Main Process (Backend/API)
├── preload.js        # Context Bridge (Secure API exposure)
├── renderer.js       # Renderer Process (UI Logic)
├── index.html        # App Entry Point (Layout)
├── sidebar.js        # (Legacy/Helper) Sidebar logic
├── webview-preload.js # Preload for the embedded GDoc view
├── package.json      # Dependencies
├── credentials.json  # OAuth2 Client Secret (from Google Console)
└── tokens.json       # (Generated) User OAuth tokens
```

### 1.3. Key Dependencies
- `electron`: App shell.
- `googleapis`: Drive/Docs API interaction.
- `express`: Local server (port 3000) for OAuth callback handling.
- `open`: Opening browser for auth.

---

## 2. Authentication Module (`main.js`)
**Goal:** Obtain `authClient` for Google APIs.
1.  **Check:** Load `tokens.json`. If valid, creating `authClient`.
2.  **Flow (if invalid):**
    - Create `OAuth2` client using `credentials.json`.
    - Generate Auth URL (`access_type: 'offline'`, scope: `drive`, `documents`).
    - Spin up `express` on `localhost:3000`.
    - Open System Browser to Auth URL.
    - **Callback:** `/oauth2callback?code=...` -> Exchange code for tokens -> Save `tokens.json` -> Kill server.

---

## 3. Data Models

### 3.1. Index Entry Schema (`_gnote_index.json`)
A flattened list where `headerId` represents a "Section".
```json
[
  {
    "fileId": "string (Drive File ID)",
    "fileName": "string",
    "headerId": "string (h.xyz123) OR 'root'",
    "headerText": "string (Section Title)",
    "fileUpdated": "ISO Date String",
    "isWebLink": boolean, // true if Web Link, undefined/false if Doc
    "tags": ["string"],   // e.g. ["#important"]
    "tasks": [
      { "text": "string", "completed": boolean }
    ],
    "todos": [
      "string (Generic Markers e.g. 'blog: post title')"
    ]
  }
]
```

### 3.2. Web Link Metadata (`appProperties`)
Web Links are Drive files with `mimeType = 'application/vnd.google-apps.document'` (dummy content) OR `shortcut`, but identified by `appProperties`.
**Key:** `role` = `web_link`
**Properties:**
```json
{
  "role": "web_link",
  "url": "https://example.com",
  "tags": "[\"tag1\", \"tag2\"]", // JSON string array
  "note": "Description text..."
}
```

---

## 4. Indexing Logic (The "Brain")

### 4.1. Parsing Regex
*   **Google Docs:**
    *   **Tasks:** `^\[\s*([xX]?)\s*\]\s*(.*)`  (Matches `[ ] Task` or `[x] Done`)
    *   **Tags:** `(#[a-zA-Z0-9-_]+)`
    *   **Markers:** `^([a-zA-Z0-9_\-]+)::\s*(.+)` (Matches `todo:: text`, `blog:: title`)
*   **Web Links:**
    *   Scan `description` (Note) field line-by-line using same regex.
    *   Also include tags from `appProperties.tags`.

### 4.2. Scanning Strategy
*   **Rebuild Index (`drive:rebuildIndex`):**
    1.  Fetch `_gnote_index.json`. Load into memory (`masterIndex`).
    2.  Query Drive for **Modified Files** (limit 30, sorted by `modifiedTime desc`).
    3.  **Parallel Scan:** For each file:
        - If Doc: Fetch content via `docs.documents.get`, parse.
        - If Web Link: Fetch metadata, parse description.
    4.  **Merge:** Remove old entries for these FileIDs from `masterIndex`, push new entries.
    5.  **Save:** Write back to `_gnote_index.json`.
    - **Smart Sync (`drive:indexFile`):**
    1.  Triggered on File Save/Close or Web Link Update.
    2.  Fetches **Metadata & Content** for that single file.
    3.  Parses & Merges into `_gnote_index.json`.
        *   **Deletions:** Old entries for this file are removed before adding new ones, so deleted tasks disappear from the index.

---

## 5. Generic Markers & Dashboard

### 5.1. Discovery
The Dashboard does not hardcode types (except Tasks/Tags).
It iterates over `entry.todos` and attempts to split strings by regex `^([a-z]+)::`.
*   **Example:** `blog:: Title` -> Type = "Blog", Content = "Title".
*   **Dynamic UI:** The "Filter" dropdown is populated at runtime based on these discovered keys.

### 5.2. Action Logic ("Open" Button)
1.  **Click Open:**
2.  **Fetch Live Metadata:** `drive:getFileDetails(id)` (Crucial to avoid stale index type mismatch).
3.  **Check Type:**
    - If `appProperties.role === 'web_link'`: Open **Edit Modal**.
    - Else: Open **WebView** to `https://docs.google.com/document/d/{id}/edit#heading={headerId}`.

---

## 6. API Reference (IPC Channels)

### 6.1. Drive Ops
*   `drive:listFiles(folderId)` -> Returns `[{ id, name, mimeType, parents }]`.
*   `drive:createFile({ parentId, name, mimeType })` -> Returns new File object.
*   `drive:getFileDetails(fileId)` -> Returns `{ metadata, revisions }`. **Must** fetch `appProperties` and `description`.

### 6.2. Web Links
*   `drive:createWebLink({ parentId, name, url, tags, note })`
    - Creates file, sets `appProperties`, returns File.
*   `drive:updateWebLink({ fileId, ... })`
    - Updates file metadata and `appProperties`.

### 6.3. Indexing
*   `drive:rebuildIndex()` -> Returns `{ success, count, data }`.
*   `drive:loadIndex()` -> Reads JSON (fast).
*   `drive:indexFile(fileId)` -> Triggers Smart Sync.
*   `drive:getAllTags()` -> Aggregates tags from Index.

---

## 7. Frontend Architecture (Renderer)

### 7.1. State Management
*   Global `currentFileId`: Tracks active doc.
*   `globalTagMap`: Cache of all tags for "Right Pane".

### 7.2. UI Components
*   **Tree View:** Recursive DOM generation from `drive:listFiles`.
*   **Dashboard:** Table view of parsed Index.
*   **Right Pane (Scanner):**
    *   **Local:** `doc:scanContent` (Live scan of current Doc text).
    *   **Global:** `drive:getAllTags` (From JSON Index).

### 7.3. Sync Triggers
*   **Create/Update Web Link:** Calls `drive:indexFile(id)` immediately.
*   **Open Dashboard:** Calls `drive:indexFile(currentFileId)` (to sync current doc) -> then `loadIndex()`.
*   **Manual Refresh:** Calls `drive:rebuildIndex()`.
