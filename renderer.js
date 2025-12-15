document.addEventListener('DOMContentLoaded', () => {
    
    // -- DOM ELEMENTS --
    const fileList = document.getElementById('file-list');
    const recentSection = document.getElementById('recent-section');
    const recentList = document.getElementById('recent-list');
    const status = document.getElementById('status');
    const webview = document.getElementById('doc-view');
    const searchBox = document.getElementById('search-box');
    const searchContentCheck = document.getElementById('search-content-check');
    
    // TOOLBAR & FILTERS
    const dailyBtn = document.getElementById('daily-btn');
    const tagFilter = document.getElementById('tag-filter'); // <--- NEW DROPDOWN
    
    // SCANNER & TAG PANE ELEMENTS
    const localTagsSection = document.getElementById('local-tags-section');
    const localTagsContainer = document.getElementById('local-tags-container');
    const docStructure = document.getElementById('doc-structure'); // Was 'scan-results'
    const globalTagsContainer = document.getElementById('global-tags-container');
    const refreshTagsBtn = document.getElementById('refresh-tags-btn');
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

    // -- DASHBOARD ELEMENTS --
    const dashboardBtn = document.getElementById('dashboard-btn');
    const dashboardView = document.getElementById('dashboard-view');
    const dashboardTable = document.getElementById('dashboard-table-body');
    const closeDashBtn = document.getElementById('close-dash-btn');

    // 1. OPEN DASHBOARD
    if (dashboardBtn) {
        dashboardBtn.onclick = async () => {
            dashboardView.style.display = 'flex'; // Show overlay
            dashboardTable.innerHTML = '<tr><td colspan="4" style="padding:20px; text-align:center;">Loading tasks...</td></tr>';
            
            const items = await window.api.getAllItems();
            
            if (items.length === 0) {
                dashboardTable.innerHTML = '<tr><td colspan="4" style="padding:20px; text-align:center; color:#999;">No tasks found in Master Index.</td></tr>';
                return;
            }

            // Render Rows
            dashboardTable.innerHTML = '';
            items.forEach(item => {
                const tr = document.createElement('tr');
                tr.style.borderBottom = '1px solid #f1f3f4';
                
                // Color code types
                let typeColor = '#666';
                if(item.type === 'Task') typeColor = '#ea4335'; // Red
                if(item.type === 'Tag') typeColor = '#34a853';  // Green
                
                tr.innerHTML = `
                    <td style="padding:12px; color:${typeColor}; font-weight:bold;">${item.type}</td>
                    <td style="padding:12px; color:#202124;">${item.content}</td>
                    <td style="padding:12px; color:#5f6368; font-size:12px;">${item.date.split(',')[0]}</td>
                    <td style="padding:12px;">
                        <button class="jump-btn" style="padding:4px 12px; background:#e8f0fe; color:#1967d2; border:none; border-radius:4px; cursor:pointer;">
                            Jump ➔
                        </button>
                    </td>
                `;
                
                // CLICK HANDLER (The Magic Link)
                const jumpBtn = tr.querySelector('.jump-btn');
                jumpBtn.onclick = () => {
                    dashboardView.style.display = 'none'; // Hide dashboard
                    
                    // Construct Deep Link
                    let link = `https://docs.google.com/document/d/${item.fileId}/edit`;
                    if (item.headerId) {
                        link += `#heading=${item.headerId}`;
                    }
                    
                    status.innerText = "Jumping to context...";
                    webview.src = link;
                };

                dashboardTable.appendChild(tr);
            });
        };
    }

    // 2. CLOSE DASHBOARD
    if (closeDashBtn) {
        closeDashBtn.onclick = () => {
            dashboardView.style.display = 'none';
        };
    }

    // -- STATE --
    let searchTimeout = null;
    let pendingCreation = null; 
    let isRecentExpanded = true;
    let copiedFile = null; 
    
    // CURRENT FILE STATE
    let currentFileId = null;
    let currentFileName = null;
    let currentScanItems = [];
    
    // GLOBAL TAG STATE
    let globalTagMap = {}; // { "#tag": ["id1", "id2"] }

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
    // 1. GLOBAL TAGS & FILTERING (The "Second Brain")
    // =========================================================================

    async function loadGlobalTags() {
        if(globalTagsContainer) globalTagsContainer.innerHTML = '<span style="color:#999; font-size:10px;">Syncing index...</span>';
        
        try {
            globalTagMap = await window.api.getAllTags();
            renderGlobalTagsCloud();
            renderTagDropdown();
        } catch (e) {
            console.error("Failed to load tags:", e);
            if(globalTagsContainer) globalTagsContainer.innerText = "Error loading tags.";
        }
    }

    function renderGlobalTagsCloud() {
        if (!globalTagsContainer) return;
        globalTagsContainer.innerHTML = '';
        const tags = Object.keys(globalTagMap).sort();
        
        if (tags.length === 0) {
            globalTagsContainer.innerHTML = '<span style="color:#ccc; font-size:10px;">No tags in Master Index.</span>';
            return;
        }

        tags.forEach(tag => {
            const pill = document.createElement('span');
            pill.innerText = tag;
            pill.style.cssText = "background:#e8eaed; color:#444; padding:2px 8px; border-radius:12px; font-size:11px; cursor:pointer; border:1px solid #dadce0;";
            pill.onclick = () => filterFilesByTag(tag); // CLICK TO FILTER
            globalTagsContainer.appendChild(pill);
        });
    }

    function renderTagDropdown() {
        if (!tagFilter) return;
        // Reset Dropdown
        tagFilter.innerHTML = '<option value="">📂 All Files</option>';
        const tags = Object.keys(globalTagMap).sort();
        
        tags.forEach(tag => {
            const opt = document.createElement('option');
            opt.value = tag;
            opt.innerText = `${tag} (${globalTagMap[tag].length})`;
            tagFilter.appendChild(opt);
        });
        
        tagFilter.onchange = () => {
            if (tagFilter.value === "") {
                init(); // Reset to root view
            } else {
                filterFilesByTag(tagFilter.value);
            }
        };
    }

    async function filterFilesByTag(tag) {
        if (!globalTagMap[tag]) return;
        
        // Sync UI
        if(tagFilter) tagFilter.value = tag;
        
        status.innerText = `Filtering by ${tag}...`;
        fileList.innerHTML = '<div style="padding:10px; color:#666; font-size:12px;">Searching...</div>';
        
        // Fetch files
        const fileIds = globalTagMap[tag];
        const files = await window.api.getFilesByIds(fileIds);
        
        fileList.innerHTML = '';
        if (files.length === 0) {
            fileList.innerHTML = '<div style="padding:10px; color:#999;">Files not found (might be deleted).</div>';
        } else {
            files.forEach(f => fileList.appendChild(createTreeItem(f)));
        }
        status.innerText = `Found ${files.length} files with ${tag}`;
    }

    // Refresh Button Handler
    if (refreshTagsBtn) {
        refreshTagsBtn.onclick = () => {
            status.innerText = "Refreshing Tag Index...";
            loadGlobalTags();
        };
    }

    // =========================================================================
    // 2. SCANNER & LOCAL TAGS logic
    // =========================================================================

    async function performScan(fileId, mimeType) {
        if (!docStructure) return;
        
        // Reset State
        currentScanItems = [];
        if (syncBtn) syncBtn.style.display = 'none';
        if (localTagsContainer) localTagsContainer.innerHTML = '';
        if (localTagsSection) localTagsSection.style.display = 'none';

        // Only scan Google Docs
        if (mimeType !== 'application/vnd.google-apps.document') {
            docStructure.innerHTML = '<div style="padding:15px; color:#ccc; font-size:12px;">Scanner only works on Google Docs</div>';
            return;
        }

        docStructure.innerHTML = '<div style="padding:15px; color:#666; font-size:12px;">Scanning document structure...</div>';

        try {
            const doc = await window.api.scanContent(fileId);
            if (!doc || !doc.content) {
                docStructure.innerHTML = '<div style="padding:15px; color:#ccc; font-size:12px;">Could not read content.</div>';
                return;
            }

            renderScanResults(doc.content, fileId);

        } catch (e) {
            console.error(e);
            docStructure.innerHTML = '<div style="padding:15px; color:red; font-size:12px;">Scan failed. Check API permissions.</div>';
        }
    }

    function renderScanResults(content, fileId) {
        docStructure.innerHTML = '';
        currentScanItems = [];
        
        let currentSection = { title: 'Top', id: '' };
        let itemsFound = 0;
        const uniqueLocalTags = new Set();

        content.forEach(element => {
            if (element.paragraph) {
                const style = element.paragraph.paragraphStyle?.namedStyleType;
                const textElements = element.paragraph.elements;
                let fullText = textElements.map(e => e.textRun?.content).join('').trim();
                
                if (!fullText) return;

                // A. IS IT A HEADING?
                if (style && style.includes('HEADING')) {
                    currentSection = { 
                        title: fullText, 
                        id: element.paragraph.paragraphStyle.headingId || '' 
                    };
                    
                    const headEl = document.createElement('div');
                    headEl.style.cssText = "padding: 8px 15px; background: #e8f0fe; font-weight:bold; font-size:12px; color:#1967d2; border-top:1px solid #eee; margin-top:5px;";
                    headEl.innerText = fullText;
                    if(currentSection.id) {
                         headEl.style.cursor = "pointer";
                         headEl.onclick = () => {
                             webview.src = `https://docs.google.com/document/d/${fileId}/edit#heading=${currentSection.id}`;
                         };
                    }
                    docStructure.appendChild(headEl);
                } 
                
                // B. IS IT A TASK?
                else if (fullText.startsWith('[]') || fullText.startsWith('[ ]') || fullText.toLowerCase().startsWith('todo:')) {
                    itemsFound++;
                    let cleanText = fullText.replace(/^\[\s*\]/, '').replace(/^todo:/i, '').trim();
                    
                    currentScanItems.push({ type: 'Task', text: cleanText, headerId: currentSection.id });

                    const taskEl = document.createElement('div');
                    taskEl.style.cssText = "padding: 6px 15px; font-size:12px; border-bottom:1px solid #f0f0f0; display:flex; align-items:start;";
                    taskEl.innerHTML = `<span style="margin-right:6px; color:#ea4335;">☐</span> <span>${cleanText}</span>`;
                    docStructure.appendChild(taskEl);
                }

                // C. IS IT A TAG?
                else if (fullText.includes('#')) {
                    const matches = fullText.match(/(#[a-zA-Z0-9-_]+)/g);
                    if (matches) {
                        itemsFound++;
                        const tagRow = document.createElement('div');
                        tagRow.style.cssText = "padding: 6px 15px; font-size:12px; border-bottom:1px solid #f0f0f0;";
                        
                        matches.forEach(tag => {
                            uniqueLocalTags.add(tag); // Add to local unique set
                            currentScanItems.push({ type: 'Tag', text: tag, headerId: currentSection.id });

                            const badge = document.createElement('span');
                            badge.innerText = tag;
                            badge.style.cssText = "background:#34a853; color:white; padding:2px 6px; border-radius:10px; font-size:10px; margin-right:4px;";
                            tagRow.appendChild(badge);
                        });
                        docStructure.appendChild(tagRow);
                    }
                }

                // D. IS IT A KEY-VALUE?
                else if (fullText.includes('::')) {
                    const parts = fullText.split('::');
                    if (parts.length === 2) {
                        itemsFound++;
                        const key = parts[0].trim();
                        const val = parts[1].trim();
                        
                        currentScanItems.push({ type: 'Meta', text: `${key}: ${val}`, headerId: currentSection.id });

                        const kvRow = document.createElement('div');
                        kvRow.style.cssText = "padding: 6px 15px; font-size:12px; border-bottom:1px solid #f0f0f0; color:#444;";
                        kvRow.innerHTML = `<strong>${key}:</strong> ${val}`;
                        docStructure.appendChild(kvRow);
                    }
                }
            }
        });

        // RENDER LOCAL UNIQUE TAGS
        if (uniqueLocalTags.size > 0) {
            localTagsSection.style.display = 'block';
            uniqueLocalTags.forEach(tag => {
                const pill = document.createElement('span');
                pill.innerText = tag;
                pill.style.cssText = "background:#34a853; color:white; padding:2px 8px; border-radius:12px; font-size:11px; cursor:pointer;";
                pill.onclick = () => filterFilesByTag(tag);
                localTagsContainer.appendChild(pill);
            });
        }

        // Show/Hide Sync Button
        if (syncBtn) syncBtn.style.display = itemsFound > 0 ? 'block' : 'none';

        if (itemsFound === 0) {
            docStructure.innerHTML = '<div style="padding:15px; color:#999; font-style:italic; font-size:12px;">No structural data found.<br>Try adding Headings, TODOs, or #tags.</div>';
        }
    }

    // =========================================================================
    // 3. UI HANDLERS (Daily, Sync, Search)
    // =========================================================================

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

    if (syncBtn) {
        syncBtn.onclick = async () => {
            if (currentScanItems.length === 0 || !currentFileId) return;
            
            const originalIcon = syncBtn.innerText;
            syncBtn.innerText = '⏳';
            syncBtn.disabled = true;
            status.innerText = "Syncing to Master Index...";
            
            try {
               await window.api.syncToSheet({ 
                   fileId: currentFileId,
                   items: currentScanItems // Backend now handles FileID and HeaderID from this
               });
               status.innerText = "Synced successfully!";
               alert("Data added to 'Master Index' spreadsheet.");
               loadGlobalTags(); // Refresh the index immediately after sync
            } catch (err) {
               console.error("Sync Error:", err);
               status.innerText = "Sync failed.";
               alert("SYNC FAILED:\n\n" + err.message);
            } finally {
               syncBtn.innerText = originalIcon;
               syncBtn.disabled = false;
            }
        };
    }

    if (refreshScanBtn) {
        refreshScanBtn.onclick = () => {
            if (currentFileId) performScan(currentFileId, 'application/vnd.google-apps.document');
        };
    }

    if (recentHeader && recentList && recentArrow) {
        recentHeader.onclick = () => {
            isRecentExpanded = !isRecentExpanded;
            recentList.style.display = isRecentExpanded ? 'block' : 'none';
            recentArrow.style.transform = isRecentExpanded ? 'rotate(0deg)' : 'rotate(-90deg)';
        };
    }

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

    // =========================================================================
    // 4. CORE FILE & TREE LOGIC
    // =========================================================================
    
    function openFile(file, mode = 'preview') {
        if (!file.webViewLink) return;
        
        currentFileId = file.id;
        currentFileName = file.name;
        
        status.innerText = `Loading: ${file.name}...`;
        let link = file.webViewLink;
        
        if (mode === 'edit') {
            link = link.replace(/\/view.*$/, '/edit').replace(/\/preview.*$/, '/edit');
        } else {
            link = link.replace(/\/edit.*$/, '/preview').replace(/\/view.*$/, '/preview');
        }

        webview.src = link;
        addToRecents(file); 
        performScan(file.id, file.mimeType);
    }

    function createTreeItem(file) {
      const isRealFolder = file.mimeType === 'application/vnd.google-apps.folder';
      const isShortcut = file.mimeType === 'application/vnd.google-apps.shortcut';
      let isFolder = isRealFolder;
      if (isShortcut && file.shortcutDetails?.targetMimeType === 'application/vnd.google-apps.folder') isFolder = true;
      
      const node = document.createElement('div'); node.className = 'tree-node';
      node.dataset.id = file.id; // <--- ADD THIS LINE (Tags the element)
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
    
    // =========================================================================
    // 5. HELPER FUNCTIONS & INIT
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

    // MENU ACTIONS (Create, Delete, etc)
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
                init(); 
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

            // 1. Capture Data
            const folderId = pendingCreation.parentId;
            const fileType = pendingCreation.type;
            closeModal();
            
            // 2. Determine MimeType
            let mimeType = 'application/vnd.google-apps.folder';
            if (fileType === 'doc') mimeType = 'application/vnd.google-apps.document';
            if (fileType === 'sheet') mimeType = 'application/vnd.google-apps.spreadsheet';
            
            status.innerText = "Creating file...";

            try {
                // 3. Create via API and GET THE NEW FILE OBJECT
                const newFile = await window.api.createFile({ parentId: folderId, name: name, mimeType: mimeType });
                
                status.innerText = "Created!";

                // 4. FIND THE PARENT IN THE UI
                // We look for the tree-node that matches the parent folder ID
                const parentNode = document.querySelector(`.tree-node[data-id="${folderId}"]`);
                
                if (parentNode) {
                    const childrenContainer = parentNode.querySelector('.tree-children');
                    const arrow = parentNode.querySelector('.tree-arrow');
                    
                    // Remove "(empty)" text if it exists
                    if (childrenContainer.innerText.includes('(empty)')) {
                        childrenContainer.innerHTML = '';
                    }

                    // Append the new file
                    const newItem = createTreeItem(newFile);
                    childrenContainer.appendChild(newItem);
                    
                    // Force Expand the parent
                    childrenContainer.style.display = 'block';
                    arrow.innerText = '▼';
                    arrow.classList.add('rotated');
                    
                    // Optional: Highlight the new file
                    newItem.querySelector('.tree-label').click();
                } else {
                    // Fallback: If we created a file in Root and can't find parent, refresh
                    init();
                }

            } catch (err) {
                console.error(err);
                status.innerText = "Error creating file.";
            }
        };
    }
    if (nameInput) nameInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') createBtn.click(); });

    // INIT
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
            loadGlobalTags(); // <--- LOAD TAGS ON STARTUP
        } else {
            const btn = document.createElement('button'); btn.id = 'login-btn'; btn.innerText = "🔑 Sign In";
            btn.onclick = () => window.api.openWebLogin();
            fileList.appendChild(btn);
        }
      } catch (e) {
        status.innerText = 'Connection failed.';
      }
    }
    
    if (window.api.onAuthSuccess) { window.api.onAuthSuccess(() => init()); }
    webview.addEventListener('ipc-message', (event) => { if (event.channel === 'header-context-menu') window.api.showHeaderMenu(event.args[0]); });

    init();
});