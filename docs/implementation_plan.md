# Implementation Plan - New Pseudo File Type: Web Link

I will implement a new "Web Link" pseudo file type. This allows users to create "files" in GNote that act as shortcuts to external websites.

## User Review Required

> [!NOTE]
> I am assuming the "New Pseudo File Type" you want is the **Web Link** (Universal Portal) mentioned in the README but found missing in the code. If you intended a different type (e.g., specific integration like Zotero), please let me know!

## Enhanced Pseudo-File: "Raindrop-Style" Web Link
To match the richness of Raindrop.io, each Web Link must carry more than just a URL.
-   **Note**: A description or annotation for the link.
-   **Tags**: A set of keywords (#research, #to-read).
-   **Collection**: Handled natively by **Google Drive Folders** (nested folders = multilevel collections).

## Proposed Changes

### Backend (`main.js`)

#### [MODIFY] [main.js](file:///c:/Users/frank/Documents/Repo/gnote/main.js)
-   **`drive:createWebLink`**:
    -   Accepts `{ parentId, name, url, note, tags }`.
    -   Creates file with `application/vnd.google-apps.drive-sdk`.
    -   **MetaData Storage**:
        -   `appProperties.role`: `'web_link'`
        -   `appProperties.url`: `[URL]`
        -   `appProperties.note`: `[User Note]`
        -   `appProperties.tags`: `[JSON String of Tags]`
    -   `description`: `URL: [URL]\n\n[Note]` (for searchable visibility).
-   **`drive:updateWebLink`**:
    -   Update `name` and `appProperties` (URL, Note, Tags).
-   **Context Menu**:
    -   If `role === 'web_link'`, show "Edit Link Details" instead of generic Edit.

#### [MODIFY] [preload.js](file:///c:/Users/frank/Documents/Repo/gnote/preload.js)
-   Expose `updateWebLink`.

#### [MODIFY] [index.html](file:///c:/Users/frank/Documents/Repo/gnote/index.html)
-   Add a new `<div id="weblink-modal">` structure:
    -   Title: "New Web Link"
    -   Fields:
        -   Name (Input)
        -   URL (Input)
        -   Tags (Input, comma-separated)
        -   Note (Textarea)
    -   Buttons: Cancel, Create

## Dashboard Refactoring
*   **Goal:** Group dashboard report by File -> Section.
*   **Changes:**
    *   Update `renderDashboardRows` in `renderer.js`.
    *   Implement grouping logic (Dictionary: `FileID -> { FileName, Sections: { HeaderID -> Tasks[] } }`).
    *   Render new Table rows:
        *   `File Header`: `colspan=5`, bold, gray background.
        *   `Section Header`: `colspan=5`, indented, italic.
        *   `Task Row`: Standard columns, but File/Section columns might be hidden or redundant (user said "group by", implying headers). I will keep them for now or remove them if redundant.
        *   I will REMOVE the File/Section columns from the item rows to reduce clutter, as the headers provide context.
    *   Update Table Header in `index.html` to remove File/Section headers?
        *   Actually, I'll keep the columns but maybe leave them empty? Or better, remove them to save space.
        *   Let's check `index.html`. It has 5 columns: Task, File, Section, Date, Action.
        *   I will modify `index.html` to remove File/Section columns, leaving: Task, Date, Action.

#### [MODIFY] [renderer.js](file:///c:/Users/frank/Documents/Repo/gnote/renderer.js)
-   **Update `createTreeItem`**:
    -   Check for `web_link` role.
    -   Render with 🌐 icon.
    -   On Click: Open URL.
-   **Update Context Menu**:
    -   "🔗 New Web Link": Opens **WebLink Modal**.
    -   "Edit Link Details": Opens **WebLink Modal** pre-filled.
    -   "ℹ️ View Details": Enhanced to show/edit the URL, Note, and Tags stored in `appProperties`.


## Implementation: Section-Based Cloud JSON Index

We will build a high-performance **Inline Database** where the atomic unit is a **Section** (a Header) within a Google Doc.

### Architecture: "The Cloud Index"
-   **Storage**: A single file `_gnote_index.json` in the root of Google Drive.
-   **Content**: An array of "Database Items".
-   **Item Schema**:
    ```json
    {
      "id": "fileId_headerId",
      "fileId": "12345",
      "fileName": "My Projects",
      "headerId": "h.abcdef",
      "headerText": "Project Alpha",
      "properties": {
        "Status": "Active",
        "Priority": "High"
      },
      "tags": ["work", "urgent"],
      "tasks": [
        { "text": "Finish presentation", "completed": false },
        { "text": "Email boss", "completed": true }
      ],
      "todos": ["todo: Review budget"],
      "lastUpdated": "2024-01-01T12:00:00Z"
    }
    ```

### Scanner Logic (`doc:scanAndParse`)
The scanner will traverse the Google Doc structure:
1.  **Track Context**: Keep track of the "Current Header" (H1/H2/H3).
2.  **Find Properties**: Look for a **Properties Table** immediately following a Header.
3.  **Find Rich Data (Scanning Section Content)**:
    -   **Tags**: Regex scan for `#hashtag` in any paragraph.
    -   **Tasks**: Identify `listItem` elements with `glyphType: 'GLYPH_TYPE_UNSPECIFIED'` (Google Docs Checkbox) or explicit `[ ]` text patterns.
    -   **Todos**: Regex scan for lines starting with `todo:` (case-insensitive).
4.  **Aggregation**: All found items are attributed to the `currentHeader`.

### UI: The Dashboard
-   **View**: A new "Database" view in GNote.
-   **Source**: Reads `_gnote_index.json`.
-   **Interaction**: Clicking a row opens the Doc **Deep-Linked** directly to that Section.

### New Tasks
1.  **Backend**: `drive:rebuildIndex` - Scans all relevant docs and builds the JSON.
2.  **Backend**: `doc:parseSectionData` - The logic to walk the doc and extract header-bound tables.
3.  **Frontend**: Dashboard UI to render the JSON table.
4.  **Backend (Smart Sync)**: `drive:indexFile(fileId)` - Updates the index for a single file on-demand.
5.  **Frontend (Smart Sync)**: Trigger indexing when a file is closed or switched.

### Manual Verification
1.  **Create Web Link**:
    -   Right-click a folder -> "New Web Link".
    -   Enter Name: "Google", URL: "https://google.com".
    -   Verify the file appears in the tree with the 🌐 icon.
2.  **Interact**:
    -   Click the new "Google" file in the tree.
    -   Verify it opens the default system browser to google.com.
3.  **Persistance**:
    -   Restart the app (or reload).
    -   Verify the link still exists and works (loaded from Drive).
