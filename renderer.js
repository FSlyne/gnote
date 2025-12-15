document.addEventListener('DOMContentLoaded', () => {
    
    // -- DOM ELEMENTS --
    const fileList = document.getElementById('file-list');
    const recentSection = document.getElementById('recent-section');
    const recentList = document.getElementById('recent-list');
    const status = document.getElementById('status');
    const webview = document.getElementById('doc-view');
    const searchBox = document.getElementById('search-box');
    const searchContentCheck = document.getElementById('search-content-check');
    
    // TOOLBAR BUTTONS
    const dailyBtn = document.getElementById('daily-btn');
    
    // SCANNER ELEMENTS
    const scanResults = document.getElementById('scan-results');
    const syncBtn = document.getElementById('sync-btn');
    const refreshScanBtn = document.getElementById('refresh-scan-btn');
    
    // COLLAPSIBLE ELEMENTS
    const recentHeader = document.getElementById('recent-header');
    const recentArrow = document.getElementById('recent-arrow');

    // MODAL ELEMENTS
    const modal = document.getElementById('name-modal');
    const modalTitle = document.getElementById('modal-title');
    const nameInput = document.getElementById('filename-input');
    const createBtn = document.getElementById('create-btn');
    const cancelBtn = document.getElementById('cancel-btn');

    // DETAILS MODAL ELEMENTS
    const detailsModal = document.getElementById('details-modal');
    const detailsTitle = document.getElementById('details-title');
    const metaTable = document.getElementById('meta-table-body');
    const versionsList = document.getElementById('versions-list');
    const closeDetailsBtn = document.getElementById('close-details-btn');

    // -- STATE --
    let searchTimeout = null;
    let pendingCreation = null; 
    let isRecentExpanded = true;
    let copiedFile = null; 
    
    // GLOBAL CURRENT FILE STATE (For Syncing)
    let currentFileId = null;
    let currentFileName = null;
    let currentScanItems = [];

    const MAX_RECENT = 10;

    // =========================================================================
    // 0. SELF-HEALING WEBVIEW
    // =========================================================================
    if (webview) {
        webview.addEventListener('render-process-gone', (e) => {
            console.warn("Webview crashed:", e.reason);
            status.innerText = "Viewer crashed. Reloading...";
            webview.reload();
        });
        webview.addEventListener('did-fail-load', (e) => {
            if (e.errorCode !== -3) { 
                status.innerText = "Error loading doc. Retrying...";
                setTimeout(() => webview.reload(), 1000);
            }
        });
        webview.addEventListener('did-finish-load', () => {
            if (status.innerText.includes('Loading') || status.innerText.includes('Opened Diary')) {
                status.innerText = 'Ready';
            }
        });
    }

    // =========================================================================
    // 1. TOOLBAR & BUTTON HANDLERS
    // =========================================================================

    // --- DAILY DIARY CLICK ---
    if (dailyBtn) {
        dailyBtn.onclick = async () => {
            dailyBtn.disabled = true;
            dailyBtn.innerHTML = '⏳ Opening...';
            status.innerText = "Locating Daily Diary...";
            try {
                const file = await window.api.openDailyDiary();
                if (file) {
                    status.innerText = `Opened Diary: ${file.name}`;
                    openFile(file, 'edit'); 
                }
            } catch (err) {
                console.error(err);
                status.innerText = "Failed to open diary.";
                alert("Could not create/open daily diary.");
            } finally {
                dailyBtn.disabled = false;
                dailyBtn.innerHTML = '<span style="margin-right: 6px;">📅</span> Open Today\'s Diary';
            }
        };
    }

// --- SYNC TO SHEET CLICK ---
    if (syncBtn) {
        syncBtn.onclick = async () => {
            // Safety check: ensure we have items to sync and a valid file ID
            if (currentScanItems.length === 0 || !currentFileId) {
                console.warn("Sync aborted: No items or no file ID.");
                return;
            }
            
            // UI Feedback: Change icon to hourglass and disable button
            const originalIcon = syncBtn.innerText;
            syncBtn.innerText = '⏳';
            syncBtn.disabled = true;
            status.innerText = "Syncing to Master Index...";
            
            try {
               // Call the backend API
               // We expect it to return 'true' if successful, or throw an error if failed
               const success = await window.api.syncToSheet({ 
                   fileId: currentFileId,
                   fileName: currentFileName,
                   items: currentScanItems 
               });
               
               if (success) {
                   status.innerText = "Synced successfully!";
                   alert("Success! Data added to 'Master Index' spreadsheet.\n\nPlease check your Google Drive Root folder.");
               } else {
                   // This happens if the backend catches an error but returns 'false' instead of throwing
                   throw new Error("Unknown backend error (API returned false). Check terminal logs.");
               }

            } catch (err) {
               console.error("Sync Error:", err);
               status.innerText = "Sync failed.";
               
               // SHOW THE REAL ERROR TO THE USER
               // This is the crucial part for troubleshooting 403/404 errors
               alert("SYNC FAILED:\n\n" + err.message + "\n\nTip: If this is a 'Permission' error, try deleting token.json and restarting.");
            
            } finally {
               // Reset UI state regardless of success or failure
               syncBtn.innerText = originalIcon;
               syncBtn.disabled = false;
            }
        };
    }

    // --- REFRESH SCAN CLICK ---
    if (refreshScanBtn) {
        refreshScanBtn.onclick = () => {
            if (currentFileId) performScan(currentFileId, 'application/vnd.google-apps.document');
        };
    }

    // --- COLLAPSIBLE RECENT FILES ---
    if (recentHeader && recentList && recentArrow) {
        recentHeader.onclick = () => {
            isRecentExpanded = !isRecentExpanded;
            recentList.style.display = isRecentExpanded ? 'block' : 'none';
            recentArrow.style.transform = isRecentExpanded ? 'rotate(0deg)' : 'rotate(-90deg)';
        };
    }

    // =========================================================================
    // 2. CORE LOGIC: OPEN FILE & SCANNER
    // =========================================================================
    
    function openFile(file, mode = 'preview') {
        if (!file.webViewLink) return;
        
        // 1. Update Global State
        currentFileId = file.id;
        currentFileName = file.name;
        
        status.innerText = `Loading: ${file.name}...`;
        let link = file.webViewLink;
        
        // 2. Handle Mode (Edit vs Preview)
        if (mode === 'edit') {
            link = link.replace(/\/view.*$/, '/edit').replace(/\/preview.*$/, '/edit');
        } else {
            link = link.replace(/\/edit.*$/, '/preview').replace(/\/view.*$/, '/preview');
        }

        webview.src = link;
        addToRecents(file); 
        
        // 3. Trigger Scanner
        performScan(file.id, file.mimeType);
    }

    async function performScan(fileId, mimeType) {
        if (!scanResults) return;
        
        // Reset State
        currentScanItems = [];
        if (syncBtn) syncBtn.style.display = 'none';

        // Only scan Google Docs
        if (mimeType !== 'application/vnd.google-apps.document') {
            scanResults.innerHTML = '<div style="padding:15px; color:#ccc; font-size:12px;">Scanner only works on Google Docs</div>';
            return;
        }

        scanResults.innerHTML = '<div style="padding:15px; color:#666; font-size:12px;">Scanning document structure...</div>';

        try {
            const doc = await window.api.scanContent(fileId);
            if (!doc || !doc.content) {
                scanResults.innerHTML = '<div style="padding:15px; color:#ccc; font-size:12px;">Could not read content.</div>';
                return;
            }

            renderScanResults(doc.content, fileId);

        } catch (e) {
            console.error(e);
            scanResults.innerHTML = '<div style="padding:15px; color:red; font-size:12px;">Scan failed. Check API permissions.</div>';
        }
    }

function renderScanResults(content, fileId) {
        scanResults.innerHTML = '';
        currentScanItems = []; 
        
        // Track the "Nearest Header"
        let currentSection = { title: 'Top', id: '' }; // Default to empty if at top
        let itemsFound = 0;

        content.forEach(element => {
            if (element.paragraph) {
                const style = element.paragraph.paragraphStyle?.namedStyleType;
                const textElements = element.paragraph.elements;
                let fullText = textElements.map(e => e.textRun?.content).join('').trim();
                
                if (!fullText) return;

                // A. IS IT A HEADING? -> Update currentSection
                if (style && style.includes('HEADING')) {
                    // Update the "Nearest Header" tracker
                    currentSection = { 
                        title: fullText, 
                        id: element.paragraph.paragraphStyle.headingId || '' 
                    };
                    
                    // (Optional) Draw Section Header in UI
                    const headEl = document.createElement('div');
                    headEl.style.cssText = "padding: 8px 15px; background: #e8f0fe; font-weight:bold; font-size:12px; color:#1967d2; border-top:1px solid #eee; margin-top:5px;";
                    headEl.innerText = fullText;
                    if(currentSection.id) {
                         headEl.style.cursor = "pointer";
                         headEl.onclick = () => {
                             webview.src = `https://docs.google.com/document/d/${fileId}/edit#heading=${currentSection.id}`;
                         };
                    }
                    scanResults.appendChild(headEl);
                } 
                
                // B. IS IT A TASK?
                else if (fullText.startsWith('[]') || fullText.startsWith('[ ]') || fullText.toLowerCase().startsWith('todo:')) {
                    itemsFound++;
                    let cleanText = fullText.replace(/^\[\s*\]/, '').replace(/^todo:/i, '').trim();
                    
                    // SAVE DATA with HEADER ID
                    currentScanItems.push({ 
                        type: 'Task', 
                        text: cleanText,
                        headerId: currentSection.id // <--- CAPTURE NEAREST HEADER
                    });

                    const taskEl = document.createElement('div');
                    taskEl.style.cssText = "padding: 6px 15px; font-size:12px; border-bottom:1px solid #f0f0f0; display:flex; align-items:start;";
                    taskEl.innerHTML = `<span style="margin-right:6px; color:#ea4335;">☐</span> <span>${cleanText}</span>`;
                    scanResults.appendChild(taskEl);
                }

                // C. IS IT A TAG?
                else if (fullText.includes('#')) {
                    const matches = fullText.match(/(#[a-zA-Z0-9-_]+)/g);
                    if (matches) {
                        itemsFound++;
                        const tagRow = document.createElement('div');
                        tagRow.style.cssText = "padding: 6px 15px; font-size:12px; border-bottom:1px solid #f0f0f0;";
                        
                        matches.forEach(tag => {
                            // SAVE DATA with HEADER ID
                            currentScanItems.push({ 
                                type: 'Tag', 
                                text: tag,
                                headerId: currentSection.id // <--- CAPTURE NEAREST HEADER
                            });

                            const badge = document.createElement('span');
                            badge.innerText = tag;
                            badge.style.cssText = "background:#34a853; color:white; padding:2px 6px; border-radius:10px; font-size:10px; margin-right:4px;";
                            tagRow.appendChild(badge);
                        });
                        scanResults.appendChild(tagRow);
                    }
                }

                // D. IS IT A KEY-VALUE?
                else if (fullText.includes('::')) {
                    const parts = fullText.split('::');
                    if (parts.length === 2) {
                        itemsFound++;
                        const key = parts[0].trim();
                        const val = parts[1].trim();
                        
                        // SAVE DATA with HEADER ID
                        currentScanItems.push({ 
                            type: 'Meta', 
                            text: `${key}: ${val}`,
                            headerId: currentSection.id // <--- CAPTURE NEAREST HEADER
                        });

                        const kvRow = document.createElement('div');
                        kvRow.style.cssText = "padding: 6px 15px; font-size:12px; border-bottom:1px solid #f0f0f0; color:#444;";
                        kvRow.innerHTML = `<strong>${key}:</strong> ${val}`;
                        scanResults.appendChild(kvRow);
                    }
                }
            }
        });

        if (syncBtn) syncBtn.style.display = itemsFound > 0 ? 'block' : 'none';

        if (itemsFound === 0) {
            scanResults.innerHTML = '<div style="padding:15px; color:#999; font-style:italic; font-size:12px;">No structural data found.<br>Try adding Headings, TODOs, or #tags.</div>';
        }
    }

    // =========================================================================
    // 3. HELPER FUNCTIONS
    // =========================================================================
    
    function formatDate(isoString) {
        if (!isoString) return 'N/A';
        return new Date(isoString).toLocaleString();
    }

    function formatSize(bytes) {
        if (!bytes) return '-';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    function getIcon(mimeType) {
        if (mimeType === 'application/vnd.google-apps.folder') return '📁';
        if (mimeType.includes('shortcut')) return '🔗'; 
        if (mimeType.includes('spreadsheet')) return '📊';
        if (mimeType.includes('document')) return '📝';
        if (mimeType.includes('presentation')) return '📑';
        if (mimeType.includes('pdf')) return '📕';
        return '📄';
    }

    // =========================================================================
    // 4. RECENTS & TREE VIEW
    // =========================================================================

    function addToRecents(file) {
        let recents = loadRecents().filter(f => f.id !== file.id);
        recents.unshift({ id: file.id, name: file.name, mimeType: file.mimeType, webViewLink: file.webViewLink });
        if (recents.length > MAX_RECENT) recents = recents.slice(0, MAX_RECENT);
        saveRecents(recents);
    }
    function loadRecents() { const data = localStorage.getItem('recentFiles'); return data ? JSON.parse(data) : []; }
    function saveRecents(files) { localStorage.setItem('recentFiles', JSON.stringify(files)); renderRecents(); }

    function renderRecents() {
        if (!recentList) return; 
        const recents = loadRecents();
        recentList.innerHTML = '';
        if (recents.length > 0) {
            if (recentSection) recentSection.style.display = 'block';
            recents.forEach(file => {
                const row = document.createElement('div');
                row.className = 'tree-label'; row.style.fontSize = '13px'; 
                row.innerHTML = `<span class="tree-icon">${getIcon(file.mimeType)}</span><span>${file.name}</span>`;
                row.onclick = () => openFile(file);
                recentList.appendChild(row);
            });
            if (!isRecentExpanded) { recentList.style.display = 'none'; recentArrow.style.transform = 'rotate(-90deg)'; }
        } else { if (recentSection) recentSection.style.display = 'none'; }
    }

    // =========================================================================
    // 5. MENU ACTIONS & TREE
    // =========================================================================
    if (window.api.onMenuAction) {
        window.api.onMenuAction(async ({ action, data }) => {
            if (action === 'create') {
                pendingCreation = data; 
                if (modalTitle) modalTitle.innerText = `Name your new ${data.type === 'folder' ? 'Folder' : 'File'}:`;
                if (nameInput) nameInput.value = "";
                if (modal) { modal.style.display = 'flex'; nameInput.focus(); }
            }
            if (action === 'details') {
                if (!detailsModal) return;
                detailsTitle.innerText = `Loading: ${data.name}...`;
                detailsModal.style.display = 'flex';
                metaTable.innerHTML = ''; versionsList.innerHTML = 'Fetching versions...';
                try {
                    const info = await window.api.getFileDetails(data.id);
                    detailsTitle.innerText = info.metadata.name;
                    metaTable.innerHTML = `<tr><td style="font-weight:bold;">Type</td><td>${info.metadata.mimeType}</td></tr><tr><td style="font-weight:bold;">Location</td><td>${info.metadata.fullPath}</td></tr><tr><td style="font-weight:bold;">Size</td><td>${formatSize(info.metadata.size)}</td></tr>`;
                    if (info.revisions.length > 0) versionsList.innerHTML = info.revisions.map(rev => `<div>${formatDate(rev.modifiedTime)} - ${rev.lastModifyingUser?.displayName}</div>`).join('');
                    else versionsList.innerHTML = 'No versions.';
                } catch (err) { versionsList.innerText = "Error."; }
            }
            if (action === 'edit') {
                status.innerText = `Opening editor...`;
                let editLink = data.link;
                if (data.shortcutDetails?.targetId) {
                    try {
                        const target = await window.api.getFileDetails(data.shortcutDetails.targetId);
                        if (target?.metadata?.webViewLink) editLink = target.metadata.webViewLink;
                    } catch (e) { console.error("Shortcut resolve failed"); }
                }
                if (editLink.includes('/view') || editLink.includes('/preview')) editLink = editLink.replace(/\/view.*$/, '/edit').replace(/\/preview.*$/, '/edit');
                webview.src = editLink;
            }
            if (action === 'copy-ref') { copiedFile = data; status.innerText = `Copied "${data.name}".`; }
            if (action === 'paste-shortcut' && copiedFile) {
                status.innerText = `Creating shortcut...`;
                await window.api.createShortcut({ targetId: copiedFile.id, parentId: data.parentId, name: copiedFile.name });
                status.innerText = `Shortcut created. Refreshing...`;
                init(); // Lazy refresh
            }
        });
    }

    function closeModal() { if (modal) modal.style.display = 'none'; pendingCreation = null; }
    if (cancelBtn) cancelBtn.onclick = closeModal;
    if (closeDetailsBtn) closeDetailsBtn.onclick = () => { detailsModal.style.display = 'none'; };

    if (createBtn) {
        createBtn.onclick = async () => {
            const name = nameInput.value.trim();
            if (!name || !pendingCreation) return; 
            closeModal();
            let mimeType = 'application/vnd.google-apps.folder';
            if (pendingCreation.type === 'doc') mimeType = 'application/vnd.google-apps.document';
            if (pendingCreation.type === 'sheet') mimeType = 'application/vnd.google-apps.spreadsheet';
            await window.api.createFile({ parentId: pendingCreation.parentId, name: name, mimeType: mimeType });
            init(); // Lazy refresh
        };
    }
    if (nameInput) nameInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') createBtn.click(); });

    // =========================================================================
    // 6. SEARCH & TREE VIEW
    // =========================================================================
    if (window.api.onAuthSuccess) { window.api.onAuthSuccess(() => init()); }
    webview.addEventListener('ipc-message', (event) => { if (event.channel === 'header-context-menu') window.api.showHeaderMenu(event.args[0]); });

    if (searchBox) {
        const performSearch = () => {
            if (searchTimeout) clearTimeout(searchTimeout);
            if (searchBox.value.trim().length === 0) { init(); return; }
            searchTimeout = setTimeout(async () => {
                const query = searchBox.value.trim();
                const isTag = query.startsWith('#');
                status.innerText = `Searching...`;
                const res = await window.api.searchFiles(isTag ? query.substring(1) : query, isTag || searchContentCheck.checked);
                fileList.innerHTML = '';
                res.forEach(f => fileList.appendChild(createTreeItem(f)));
                status.innerText = `Found ${res.length} results.`;
            }, 500);
        };
        searchBox.addEventListener('input', performSearch);
    }

    function createTreeItem(file) {
      const isRealFolder = file.mimeType === 'application/vnd.google-apps.folder';
      const isShortcut = file.mimeType === 'application/vnd.google-apps.shortcut';
      let isFolder = isRealFolder;
      if (isShortcut && file.shortcutDetails?.targetMimeType === 'application/vnd.google-apps.folder') isFolder = true;
      
      const node = document.createElement('div'); node.className = 'tree-node';
      const label = document.createElement('div'); label.className = 'tree-label'; label.draggable = true;
      const arrow = document.createElement('span'); arrow.className = 'tree-arrow'; arrow.innerText = isFolder ? '▶' : '';
      label.innerHTML = `<span class="tree-icon">${getIcon(file.mimeType)}</span><span>${file.name}</span>`;
      label.prepend(arrow);
      
      const children = document.createElement('div'); children.className = 'tree-children';
      node.appendChild(label); node.appendChild(children);

      label.onclick = async (e) => {
        e.stopPropagation();
        document.querySelectorAll('.tree-label').forEach(el => el.classList.remove('selected'));
        label.classList.add('selected');
        
        // --- NORMAL OPENING (Defaults to Preview) ---
        if (!isFolder) { openFile(file); return; }
        
        if (children.style.display === 'block') {
            children.style.display = 'none'; arrow.innerText = '▶'; arrow.classList.remove('rotated');
        } else {
            children.style.display = 'block'; arrow.innerText = '▼'; arrow.classList.add('rotated');
            if (children.children.length === 0) {
                const res = await window.api.listFiles(file.id);
                if (res.length === 0) children.innerHTML = '<div style="padding-left:24px; font-size:12px; color:#999;">(empty)</div>';
                else res.forEach(child => children.appendChild(createTreeItem(child)));
            }
        }
      };

      label.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        window.api.showContextMenu({ 
            name: file.name, link: file.webViewLink, isFolder: isFolder, id: file.id, parentId: (file.parents ? file.parents[0] : 'root'), hasCopiedFile: !!copiedFile, shortcutDetails: file.shortcutDetails
        });
      });

      return node;
    }
  
    async function init() {
      const oldBtn = document.getElementById('login-btn'); if (oldBtn) oldBtn.remove();
      renderRecents();
      try {
        status.innerText = 'Checking connection...';
        const rootFiles = await window.api.listFiles('root');
        fileList.innerHTML = '';
        if (rootFiles.length > 0) {
            status.innerText = 'Ready';
            rootFiles.forEach(file => fileList.appendChild(createTreeItem(file)));
        } else {
            const btn = document.createElement('button'); btn.id = 'login-btn'; btn.innerText = "🔑 Sign In";
            btn.onclick = () => window.api.openWebLogin();
            fileList.appendChild(btn);
        }
      } catch (e) {
        status.innerText = 'Connection failed.';
      }
    }
    init();
});