Version 1v.2

Background
GNote is a desktop productivity application that transforms Google Drive from a simple cloud storage service into a Unified Knowledge Management System. Built on Electron, it provides a seamless three-pane interface where users can view documents, manage files via drag-and-drop, and utilize "Pseudo-Files"—smart shortcuts that treat external links (like Dropbox or Trello) and specific document sections as native files within your folder tree. This allows for a completely unified project workspace where all resources, regardless of their origin, live side-by-side.

Beyond organization, GNote adds a layer of intelligence to your data. Its real-time Content Scanner automatically parses open documents to extract headings, tasks, hashtags, and metadata, visualizing connections in a Graph View or syncing them to a "Master Index" Google Sheet. By bridging the gap between a file explorer and a second-brain tool, GNote turns static Google Docs into a dynamic, interconnected database without ever leaving the Google ecosystem.


Features and Functionality
1. Core Navigation & Viewing
File Tree Explorer: A navigable, hierarchical left sidebar showing your Google Drive folders and files.

Embedded Viewer: Opens Google Docs, Sheets, and Slides directly inside the app (center pane) without launching a separate browser.

Recent Files: Automatically tracks and lists the last 10 opened files for quick access.

Search: Real-time search box that can query file names or perform full-text searches inside documents; supports `#tag` shortcut searches and includes a clear (×) control that resets the tree to the default view.

2. Document Intelligence (The "Scanner")
Automatic Parsing: When you open a Google Doc, the right sidebar ("Scanner") automatically analyzes the content.

Outline View: Displays a clickable table of contents based on the document's Headings (Google Docs only; other MIME types are skipped with a notice).

Task Extraction: Identifies and lists tasks marked with [], [ ], TODO:, native checkboxes, or manual strikethrough.

Tag Extraction: detailed listing of all hashtags (#tag) found in the text.

Metadata Extraction: Finds and lists Key::Value pairs (e.g., Status:: Done).

Master Index Sync: A button to sync all found tags and tasks to a central "Master Index" Google Sheet for a global dashboard view.
Comments: Lists document comments; provides a manual sync button to push findings.

3. File Management
Drag & Drop Moving: Move files into folders by dragging them in the tree view.

Context Menu: Right-click any file/folder to:

📂 Create New Folder

📝 Create New Google Doc

📊 Create New Google Sheet

✏️ Rename File/Folder

✂️ Cut / Paste (Move items)

🔗 Copy Shortcut Reference

ℹ️ View File Details (Metadata & Version History)

Location Path: Details modal shows the full Drive path (Location) alongside type, size, and recent revisions.

AI Actions: Right-click files/folders to "Summarize with AI" or "Ask AI About This"; uses document content for context and returns inline responses.

Creation Modal: A unified interface to create new files, folders, or web links.

4. Advanced "Pseudo-File" System
This feature turns your Drive into a universal dashboard by allowing you to create special nodes in the file tree:

Web Links (Universal Portals): Create "files" that are actually links to external services (Dropbox, Trello, GitHub, Zotero, etc.). The app automatically assigns specific icons (📦, 📰, 🐙) based on the URL.

Section Links (Deep Linking): Drag a Heading from the right sidebar scanner onto a Folder in the left sidebar to create a "bookmark file." Clicking this file opens the original document and scrolls directly to that specific chapter.
These are zero-byte drive-sdk pseudo-files that store source file and heading metadata, so they behave like jump links inside the tree.

5. Dashboards & Tools
Graph View: A visual network diagram showing how your files are connected via shared #tags.
Nodes are clickable to open docs, powered by vis-network (must be present in the environment).

"Today" Button: One-click feature that finds or creates a Google Doc for the current date inside a "Daily" folder (Journaling feature, copies a template if present, otherwise creates blank).

Task Dashboard: A table view overlay aggregating all tasks and tags synced to your Master Index, with status filter (All/Open/Closed), sort options (Newest/Oldest/Recently Closed), task counts, zebra rows, and "Jump" links into the source doc/heading.

6. Technical & Security Features
External Link Interception: Links clicked inside a Google Doc (or Pseudo-files) automatically open in your default OS browser (Chrome/Edge/Safari) instead of getting stuck inside the app.

Crash Prevention: Custom User-Agent handling to prevent Google Drive from blocking the Electron embedded view.

Security: Implemented Content Security Policy (CSP) and restricted webview permissions (no popups) for safety.

Resilience: Tag loading and Drive search calls timeout with user-visible errors instead of freezing the UI.

7. User Interface
Resizable Layout: The right sidebar (Scanner) can be resized or toggled on/off.

Visual Feedback: Status bar updates for all operations (Loading, Syncing, Moving, Renaming).

Visual Cues: Specific icons for different file types, folders, and shortcuts.

Architecture
The architecture of GNote (Google Drive Explorer) is built on the Electron framework, utilizing a classic multi-process architecture that enforces security and separation of concerns. It operates as a desktop application that interfaces directly with Google's Cloud APIs, effectively treating Google Drive as a remote file system and database.

Here is the architectural breakdown:

1. High-Level Diagram
The system follows a 3-Tier Architecture:

Presentation Layer (Renderer): The UI and user interaction.

Bridge Layer (Preload): The secure communication channel.

Logic & Data Layer (Main Process): The backend logic, API handling, and authentication.

2. Component Breakdown
A. The Frontend (Renderer Process)
This is the "Client" side of your application. It runs in a sandboxed Chromium environment.

Tech Stack: HTML5, CSS3, Vanilla JavaScript.

Responsibilities:

UI Rendering: Draws the 3-pane layout (Sidebar Tree, Central Viewer, Scanner Pane).

State Management: Tracks current selection, expanded folders, and recent files (using localStorage).

Interactive Logic: Handles Drag & Drop events (sorting headers vs. files), Context Menus, and Graph visualizations (vis-network).

Embedded View: Hosts the <webview> tag to render Google Docs safely.

Security: Runs with Context Isolation enabled. It cannot access Node.js primitives (like fs or require) directly. It must request data via the window.api bridge.

B. The Secure Bridge (Preload Script)
This is the security checkpoint. It is the only part of the code that has access to both the DOM (Renderer) and the Node.js environment (Main).

Tech Stack: Electron contextBridge, ipcRenderer.

Responsibilities:

API Exposure: It selectively exposes functions to the frontend. For example, it exposes createFile() but hides the raw fs.writeFile() capability.

Event Forwarding: Listens for backend events (like auth:success or menu-action) and forwards them to the frontend.

C. The Backend (Main Process)
This is the "Server" side, running in a full Node.js environment.

Tech Stack: Node.js, googleapis library, Electron ipcMain.

Responsibilities:

Authentication: Manages the OAuth2 lifecycle. It spins up a temporary local HTTP server (localhost:3000) to catch the Google Login callback and stores credentials in token.json.

API Orchestration: All calls to Google Drive, Docs, and Sheets happen here. This keeps API keys and tokens secure.

Business Logic:

The "Scanner": Downloads the raw JSON structure of a Google Doc, parses it for Headings/Tasks/Tags, and sends a simplified object to the UI.

Pseudo-File System: It implements the logic to read/write appProperties. When it sees a file with role: 'section_link', it knows to treat it as a shortcut rather than a file.

System Integration: Handles opening external URLs in the user's default browser (shell.openExternal).

3. Data Flow Examples
Scenario 1: The "Scanner" (Reading Data)
User clicks a file in the Left Sidebar.

Renderer calls window.api.scanContent(fileId).

Bridge passes the message to the Main Process.

Main uses google.docs.get() to fetch the document structure.

Main parses the complex Google JSON, extracting only Headings and Tasks.

Main returns this clean data to the Renderer.

Renderer updates the Right Sidebar DOM.

Scenario 2: Creating a "Section Link" (Writing Data)
User drags a Heading from the Right Sidebar to a Folder in the Left Sidebar.

Renderer captures the drop event and calls window.api.createSectionLink(...).

Main receives the request.

Main calls drive.files.create() with a special payload:

MIME Type: application/vnd.google-apps.drive-sdk (Custom).

Metadata: Injects appProperties with the headerId and sourceFileId.

Google Drive saves this 0-byte "Pseudo-File".

Renderer refreshes the folder tree to show the new bookmark icon.

Scenario 3: Viewing a Document (Hybrid Rendering)
Renderer sets the <webview> source to the Google Docs URL.

Electron acts as a specialized browser window.

Renderer attaches listeners to the <webview> to intercept "New Window" events (links clicked inside the doc) so they don't break out of the app.

4. Storage Architecture
The application is "Stateless" locally (except for authentication tokens).

Primary DB: Google Drive (Files, Folders, and Pseudo-Files).

Metadata DB: Google Sheets (The "Master Index" file acts as a relational DB for your Tags and Tasks).

Local Cache: localStorage (Browser side) stores strictly UI preferences like "Recent Files" list or "Last Opened Folder".

This architecture allows the application to be incredibly lightweight while managing gigabytes of cloud data.


Support Tools
https://console.cloud.google.com/apis/api/sheets.googleapis.com/metrics?project=gnote-481022

AI Support
1. https://gemini.google.com/app/239426ed00b1585c
0. https://gemini.google.com/app/d787d3743598b65b
