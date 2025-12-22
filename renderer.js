document.addEventListener('DOMContentLoaded', () => {

    // Ensure preload bridge is available
    if (!window.api) {
        const status = document.getElementById('status');
        if (status) status.innerText = 'API bridge unavailable';
        console.error('window.api is undefined; preload may have failed to load.');
        return;
    }
    
    // =========================================================================
    // 1. DOM ELEMENTS
    // =========================================================================
    const sidebar = document.getElementById('sidebar');
    const webview = document.getElementById('doc-view');
    const status = document.getElementById('status');

    // PANES
    const scannerPane = document.getElementById('scanner-pane'); 
    const dragHandle = document.getElementById('drag-handle');
    const togglePaneBtn = document.getElementById('toggle-pane-btn'); 

    // TOOLS
    const fileList = document.getElementById('file-list');
    const recentSection = document.getElementById('recent-section');
    const recentList = document.getElementById('recent-list');
    const recentHeader = document.getElementById('recent-header');
    const recentArrow = document.getElementById('recent-arrow');
    const searchBox = document.getElementById('search-box');
    const searchContentCheck = document.getElementById('search-content-check');
    const searchClearBtn = document.getElementById('search-clear-btn');
    const tagFilter = document.getElementById('tag-filter');
    const dailyBtn = document.getElementById('daily-btn');         
    const dashboardBtn = document.getElementById('dashboard-btn'); 
    const starredBtn = document.getElementById('starred-btn');
    
    // CONTENT
    const localTagsSection = document.getElementById('local-tags-section');
    const localTagsContainer = document.getElementById('local-tags-container');
    const docStructure = document.getElementById('doc-structure');
    const globalTagsContainer = document.getElementById('global-tags-container');
    const refreshTagsBtn = document.getElementById('refresh-tags-btn');

    // OVERLAYS
    const dashboardView = document.getElementById('dashboard-view');
    const dashboardTable = document.getElementById('dashboard-table-body');
    const closeDashBtn = document.getElementById('close-dash-btn');
    const graphView = document.getElementById('graph-view');
    const closeGraphBtn = document.getElementById('close-graph-btn');
    const networkContainer = document.getElementById('network-container');

    // MODALS
    const modal = document.getElementById('name-modal');
    const modalTitle = document.getElementById('modal-title');
    const nameInput = document.getElementById('filename-input');
    const createBtn = document.getElementById('create-btn');
    const cancelBtn = document.getElementById('cancel-btn');
    const detailsModal = document.getElementById('details-modal');
    const detailsTitle = document.getElementById('details-title');
    const metaTable = document.getElementById('meta-table-body');
    const versionsList = document.getElementById('versions-list');
    const versionsContainer = document.getElementById('versions-container');
    const closeDetailsBtn = document.getElementById('close-details-btn');

    const questionModal = document.getElementById('question-modal');
    const questionInput = document.getElementById('question-input');
    const askAiBtn = document.getElementById('ask-ai-btn');
    const cancelQuestionBtn = document.getElementById('cancel-question-btn');
    const aiContextLabel = document.getElementById('ai-context-label');

    // =========================================================================
    // 2. STATE
    // =========================================================================
    let searchTimeout = null;
    let pendingCreation = null;
    let pendingRename = null;
    let pendingAIFile = null; 
    let isResizing = false;
    let clipboardItem = null; 
    let currentFileId = null;
    let currentFileName = null;
    let currentScanItems = [];
    let globalTagMap = {}; 
    const MAX_RECENT = 10;

    // =========================================================================
    // 3. HELPERS
    // =========================================================================

    // HELPER: Extract text from Google Doc JSON structure
    // Defined here so it's accessible to both Menu Actions and Button Clicks
    async function getDocTextSnippet(fileId, limit = 6000) {
        try {
            const res = await window.api.scanContent(fileId);
            if (!res || !res.doc || !res.doc.body || !res.doc.body.content) return null;
            
            const chunks = [];
            let length = 0;
            
            const addText = (text) => {
                if (!text) return;
                if (length >= limit) return;
                const slice = text.replace(/\s+/g, ' ').trim();
                if (slice) {
                    chunks.push(slice);
                    length += slice.length;
                }
            };
            
            const walk = (contentList) => {
                contentList.forEach(el => {
                    if (el.paragraph && el.paragraph.elements) {
                        el.paragraph.elements.forEach(elem => {
                            if (elem.textRun && elem.textRun.content) addText(elem.textRun.content);
                        });
                    }
                    if (el.table) {
                        el.table.tableRows.forEach(row => row.tableCells.forEach(cell => walk(cell.content || [])));
                    }
                });
            };
            
            walk(res.doc.body.content);
            return chunks.join('\n\n'); 
        } catch (e) {
            console.warn('Doc snippet extraction failed:', e);
            return null;
        }
    }

    // =========================================================================
    // 4. CORE UI ACTIONS
    // =========================================================================

    function toggleScanner() {
        if (!scannerPane) return;
        const isHidden = scannerPane.style.display === 'none';
        scannerPane.style.display = isHidden ? 'flex' : 'none';
        if (dragHandle) dragHandle.style.display = isHidden ? 'block' : 'none';
        if (togglePaneBtn) togglePaneBtn.innerHTML = isHidden ? '👁️' : '🚫'; 
    }

    async function openDashboard() {
        if (!dashboardView) return;
        dashboardView.style.display = 'flex';
        dashboardTable.innerHTML = '<tr><td colspan="5" style="padding:20px; text-align:center;">Loading tasks...</td></tr>';
        
        const allItems = await window.api.getAllItems();
        
        // Render Dashboard Logic
        let filterContainer = document.getElementById('dash-filter-container');
        if (!filterContainer) {
            const headerSection = dashboardView.querySelector('div');
            filterContainer = document.createElement('div');
            filterContainer.id = 'dash-filter-container';
            filterContainer.style.cssText = "padding: 10px 20px; background: #f8f9fa; border-bottom: 1px solid #eee; display:flex; gap:10px; align-items:center;";
            filterContainer.innerHTML = `
                <select id="dash-status-filter" style="padding:6px; border-radius:4px; border:1px solid #ccc; font-size:12px;">
                    <option value="All">All Status</option>
                    <option value="Open" selected>Open Only</option>
                    <option value="Closed">Closed Only</option>
                </select>
                <select id="dash-sort-filter" style="padding:6px; border-radius:4px; border:1px solid #ccc; font-size:12px;">
                    <option value="Newest">Newest Created</option>
                    <option value="Oldest">Oldest Created</option>
                </select>
                <span style="flex:1;"></span>
                <span id="dash-count" style="font-size:12px; color:#666;"></span>
            `;
            headerSection.insertAdjacentElement('afterend', filterContainer);
            document.getElementById('dash-status-filter').addEventListener('change', renderDashboard);
            document.getElementById('dash-sort-filter').addEventListener('change', renderDashboard);
        }

        function renderDashboard() {
            const statusFilter = document.getElementById('dash-status-filter').value;
            const sortFilter = document.getElementById('dash-sort-filter').value;
            
            let filtered = allItems.filter(item => {
                if (statusFilter === 'All') return true;
                return item.status === statusFilter;
            });

            filtered.sort((a, b) => {
                const dateA = new Date(a.created).getTime();
                const dateB = new Date(b.created).getTime();
                if (sortFilter === 'Newest') return dateB - dateA;
                return dateA - dateB;
            });

            dashboardTable.innerHTML = '';
            document.getElementById('dash-count').innerText = `${filtered.length} tasks`;

            if (filtered.length === 0) {
                dashboardTable.innerHTML = '<tr><td colspan="5" style="padding:20px; text-align:center; color:#999;">No tasks found.</td></tr>';
                return;
            }

            filtered.forEach(item => {
                const tr = document.createElement('tr');
                tr.style.cssText = "background: white;"; 
                if (dashboardTable.children.length % 2 === 0) tr.style.background = "#fcfcfc";
                let statusColor = '#d93025'; let statusBg = '#fce8e6';
                if (item.status === 'Closed') { statusColor = '#188038'; statusBg = '#e6f4ea'; }
                
                tr.innerHTML = `
                    <td style="padding:4px 8px;">
                        <span style="background:${statusBg}; color:${statusColor}; padding:2px 6px; border-radius:4px; font-size:10px; font-weight:bold; display:inline-block; width:45px; text-align:center;">
                            ${item.status.toUpperCase()}
                        </span>
                    </td>
                    <td style="padding:4px 8px; color:#202124; font-size:13px;">${item.content}</td>
                    <td style="padding:4px 8px; color:#5f6368; font-size:11px;">${item.created ? item.created.split(',')[0] : '-'}</td>
                    <td style="padding:4px 8px;">
                        <button class="jump-btn" style="padding:2px 8px; background:#f1f3f4; color:#1967d2; border:none; border-radius:3px; cursor:pointer; font-size:11px;">Jump</button>
                    </td>
                `;
                tr.querySelector('.jump-btn').onclick = () => {
                    dashboardView.style.display = 'none';
                    let link = `https://docs.google.com/document/d/${item.fileId}/edit`;
                    if (item.headerId) link += `#heading=${item.headerId}`;
                    webview.src = link;
                };
                dashboardTable.appendChild(tr);
            });
        }
        renderDashboard();
    }

    async function openToday() {
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
        }
    }

    function showGraph() {
        if(!graphView) return;
        graphView.style.display = 'block';
        const nodes = []; const edges = []; const processedFiles = new Set();
        Object.keys(globalTagMap).forEach((tag) => {
            nodes.push({ id: tag, label: tag, color: '#34a853', shape: 'hexagon', size: 20, font: { color: 'white' } });
            globalTagMap[tag].forEach(fileId => {
                if (!processedFiles.has(fileId)) {
                    nodes.push({ id: fileId, label: 'File ' + fileId.substr(0,4), color: '#4285f4', shape: 'dot', size: 10 });
                    processedFiles.add(fileId);
                }
                edges.push({ from: fileId, to: tag });
            });
        });
        const data = { nodes, edges };
        const options = { nodes: { borderWidth: 2 }, interaction: { hover: true }, physics: { stabilization: false, barnesHut: { gravitationalConstant: -3000 } } };
        
        if (window.vis) {
             const network = new window.vis.Network(networkContainer, data, options);
             network.on("click", function (params) {
                if (params.nodes.length > 0) {
                    const nodeId = params.nodes[0];
                    if (!nodeId.startsWith('#')) {
                        graphView.style.display = 'none';
                        webview.src = `https://docs.google.com/document/d/${nodeId}/edit`;
                    }
                }
            });
        } else { networkContainer.innerText = "Graph library not loaded."; }
    }

    // =========================================================================
    // 5. EVENT BINDINGS
    // =========================================================================

    if (togglePaneBtn) togglePaneBtn.onclick = toggleScanner;
    if (dashboardBtn) dashboardBtn.onclick = openDashboard;
    if (dailyBtn) dailyBtn.onclick = openToday;
    if (closeDashBtn) closeDashBtn.onclick = () => dashboardView.style.display = 'none';
    if (closeGraphBtn) closeGraphBtn.onclick = () => graphView.style.display = 'none';

    if (starredBtn) {
        starredBtn.onclick = async () => {
            starredBtn.classList.add('active'); 
            status.innerText = "Loading Starred files...";
            fileList.innerHTML = '<div style="padding:10px; color:#666; font-size:12px;">Fetching starred items...</div>';
            try {
                const files = await window.api.getStarredFiles();
                fileList.innerHTML = '';
                if (files.length === 0) {
                    fileList.innerHTML = '<div style="padding:10px; color:#999;">No starred files found.</div>';
                } else {
                    files.forEach(file => fileList.appendChild(createTreeItem(file)));
                }
                status.innerText = `Found ${files.length} starred items.`;
            } catch (e) {
                console.error(e);
                status.innerText = "Error loading starred files.";
            }
        };
    }

    // DRAG RESIZE
    if (dragHandle && scannerPane) {
        dragHandle.addEventListener('mousedown', (e) => {
            e.preventDefault(); isResizing = true; dragHandle.classList.add('active');
            if (webview) webview.style.pointerEvents = 'none';
            document.body.style.userSelect = 'none'; document.body.style.cursor = 'col-resize';
        });
        document.addEventListener('mousemove', (e) => {
            if (!isResizing) return;
            const newWidth = window.innerWidth - e.clientX;
            if (newWidth > 150 && newWidth < 600) { scannerPane.style.width = `${newWidth}px`; }
        });
        document.addEventListener('mouseup', () => {
            if (isResizing) {
                isResizing = false; dragHandle.classList.remove('active');
                if (webview) webview.style.pointerEvents = 'auto';
                document.body.style.userSelect = ''; document.body.style.cursor = '';     
            }
        });
    }

    // =========================================================================
    // 6. MENU & AI ACTION HANDLER (FIXED)
    // =========================================================================

    if (window.api.onMenuAction) {
        window.api.onMenuAction(async ({ action, data }) => {
            
            // --- GLOBAL COMMANDS ---
            if (action === 'toggle-dashboard') openDashboard();
            if (action === 'toggle-scanner') toggleScanner();
            if (action === 'show-graph') showGraph();
            if (action === 'open-today') openToday();

            // --- AI SUMMARIZE ---
            if (action === 'ai-summarize') {
                status.innerText = `Reading ${data.name}...`;
                // 1. Get Text
                const contextText = await getDocTextSnippet(data.id);
                if (!contextText) {
                    alert("Could not read document content. The file might be empty.");
                    status.innerText = "Read failed";
                    return;
                }

                status.innerText = `Generating summary...`;
                try {
                    // 2. Call AI
                    const result = await window.api.processWithAI({ 
                        fileId: data.id, 
                        promptType: 'summarize',
                        content: contextText // Send content
                    });

                    // 3. Show Result
                    detailsTitle.innerText = `✨ AI Summary: ${data.name}`;
                    const htmlContent = window.api.parseMarkdown(result.text || result.answer || "No response.");
                    metaTable.innerHTML = `<div style="padding:20px; line-height:1.6; font-size:14px; color:#333;">${htmlContent}</div>`;
                    
                    if(versionsContainer) versionsContainer.style.display = 'none'; // Hide versions
                    detailsModal.style.display = 'flex';
                    status.innerText = "Summary ready.";
                } catch (err) {
                    console.error(err);
                    status.innerText = "AI Error.";
                    alert("AI Error: " + err.message);
                }
            }

            // --- AI ASK (Setup) ---
            if (action === 'ai-ask') {
                pendingAIFile = data;
                aiContextLabel.innerText = `Context: ${data.name}`;
                questionInput.value = '';
                questionModal.style.display = 'flex';
                questionInput.focus();
            }

            // --- FILE ACTIONS ---
            if (action === 'toggle-star') {
                status.innerText = data.addStar ? "Adding to Starred..." : "Removing from Starred...";
                try {
                    await window.api.toggleStar({ fileId: data.id, addStar: data.addStar });
                    status.innerText = data.addStar ? "Starred!" : "Unstarred!";
                    if (document.getElementById('starred-btn').classList.contains('active')) {
                         document.getElementById('starred-btn').click();
                    }
                } catch (e) { status.innerText = "Action failed."; }
            }

            if (action === 'rename') {
                pendingRename = data; 
                modalTitle.innerText = "Rename File"; nameInput.value = data.name; createBtn.innerText = "Rename";
                if (modal) { modal.style.display = 'flex'; nameInput.focus(); }
            }

            if (action === 'create') {
                pendingCreation = data; 
                modalTitle.innerText = `Name your new ${data.type === 'folder' ? 'Folder' : 'File'}:`;
                nameInput.value = ""; createBtn.innerText = "Create";
                if (modal) { modal.style.display = 'flex'; nameInput.focus(); }
            }

            if (action === 'details') {
                if (!detailsModal) return;
                detailsTitle.innerText = `Loading: ${data.name}...`; detailsModal.style.display = 'flex';
                metaTable.innerHTML = ''; 
                if(versionsContainer) versionsContainer.style.display = 'block';
                versionsList.innerHTML = 'Fetching versions...';
                
                try {
                    const info = await window.api.getFileDetails(data.id);
                    detailsTitle.innerText = info.metadata.name;
                    const pathString = info.metadata.fullPath || '-';
                    metaTable.innerHTML = `
                        <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
                        <tr><td style="padding:5px;">Type</td><td>${info.metadata.mimeType}</td></tr>
                        <tr><td style="padding:5px;">Size</td><td>${info.metadata.size||'-'}</td></tr>
                        <tr><td style="padding:5px;">Location</td><td title="${pathString}">${pathString}</td></tr>
                        </table>
                    `;
                    if (info.revisions.length > 0) versionsList.innerHTML = info.revisions.map(rev => `<div>${new Date(rev.modifiedTime).toLocaleString()}</div>`).join('');
                    else versionsList.innerHTML = 'No versions.';
                } catch (err) { versionsList.innerText = "Error."; }
            }

            if (action === 'edit') {
                status.innerText = `Opening editor...`;
                let editLink = data.link;
                if (editLink.includes('/view')) editLink = editLink.replace(/\/view.*$/, '/edit');
                webview.src = editLink;
            }

            if (action === 'copy-ref') { clipboardItem = { ...data, mode: 'shortcut' }; status.innerText = `Copied Link to "${data.name}"`; }
            if (action === 'cut-item') { clipboardItem = { ...data, mode: 'move' }; status.innerText = `Cut "${data.name}" (Ready to paste)`; }

            if (action === 'paste-item' && clipboardItem) {
                const destId = data.parentId; 
                if (clipboardItem.mode === 'shortcut') {
                    status.innerText = `Creating shortcut...`;
                    await window.api.createShortcut({ targetId: clipboardItem.id, parentId: destId, name: clipboardItem.name });
                    status.innerText = "Shortcut created!";
                    refreshFolder(destId);
                } else if (clipboardItem.mode === 'move') {
                    status.innerText = `Moving "${clipboardItem.name}"...`;
                    try {
                        const oldParent = clipboardItem.parentId;
                        await window.api.moveFile({ fileId: clipboardItem.id, oldParentId: oldParent, newParentId: destId });
                        status.innerText = "Move successful!";
                        refreshFolder(destId); 
                        if (oldParent !== destId) refreshFolder(oldParent);
                        clipboardItem = null; 
                    } catch (e) { status.innerText = "Move failed."; alert("Error moving item."); }
                }
            }
        });
    }

    // =========================================================================
    // 7. AI "ASK" BUTTON HANDLER (FIXED)
    // =========================================================================
    
    if (askAiBtn) {
        askAiBtn.onclick = async () => {
            const userQuestion = questionInput.value.trim();
            if (!userQuestion || !pendingAIFile) return;

            questionModal.style.display = 'none';
            status.innerText = "Reading file...";
            
            try {
                // 1. Fetch Content
                const contextText = await getDocTextSnippet(pendingAIFile.id);
                if (!contextText) {
                    alert("Could not read file context.");
                    status.innerText = "Ready";
                    return;
                }

                status.innerText = "Asking AI...";
                
                // 2. Send to API
                const result = await window.api.processWithAI({ 
                    fileId: pendingAIFile.id, 
                    promptType: 'ask', 
                    userQuery: userQuestion,
                    content: contextText // Include content
                });

                // 3. Display Result
                detailsTitle.innerText = `❓ Question: ${userQuestion}`;
                const htmlContent = window.api.parseMarkdown(result.text || result.answer);

                metaTable.innerHTML = `
                    <div style="padding:20px; font-size:14px; color:#333;">
                        <div style="margin-bottom:10px; color:#666; font-size:12px;">Answer based on <strong>${pendingAIFile.name}</strong>:</div>
                        <div style="line-height:1.6;">${htmlContent}</div>
                    </div>
                `;
                if(versionsContainer) versionsContainer.style.display = 'none';
                detailsModal.style.display = 'flex';
                status.innerText = "Answer received.";
            } catch (err) {
                console.error(err);
                status.innerText = "AI failed.";
                alert("Error: " + err.message);
            }
        };
    }

    if (cancelQuestionBtn) {
        cancelQuestionBtn.onclick = () => { questionModal.style.display = 'none'; pendingAIFile = null; };
    }
    if (questionInput) {
        questionInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') askAiBtn.click(); });
    }


    // =========================================================================
    // 8. FILE TREE & SCANNER LOGIC
    // =========================================================================

    // WEBVIEW HANDLERS
    if (webview) {
        webview.addEventListener('render-process-gone', (e) => status.innerText = "Viewer crashed.");
        webview.addEventListener('did-finish-load', () => { if (status.innerText.includes('Loading')) status.innerText = 'Ready'; });
        webview.addEventListener('new-window', (e) => { e.preventDefault(); if (e.url.startsWith('http')) window.api.openExternal(e.url); });
    }

    async function loadGlobalTags() {
        if (globalTagsContainer) globalTagsContainer.innerHTML = '<span style="color:#999; font-size:10px;">Syncing index...</span>';
        const timeoutMs = 8000;
        const tagPromise = window.api.getAllTags();
        const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Tag load timed out')), timeoutMs));
        try {
            globalTagMap = await Promise.race([tagPromise, timeoutPromise]);
            if(globalTagsContainer) {
                globalTagsContainer.innerHTML = '';
                const tags = Object.keys(globalTagMap).sort();
                if (tags.length === 0) globalTagsContainer.innerHTML = '<span style="color:#999; font-size:11px;">No tags found.</span>';
                tags.forEach(tag => {
                    const pill = document.createElement('span');
                    pill.innerText = tag;
                    pill.style.cssText = "background:#e8eaed; color:#444; padding:2px 8px; border-radius:12px; font-size:11px; cursor:pointer; border:1px solid #dadce0;";
                    pill.onclick = () => filterFilesByTag(tag);
                    globalTagsContainer.appendChild(pill);
                });
            }
            if (status.innerText === "Refreshing..." || status.innerText.includes("Syncing")) status.innerText = "Tags loaded.";
        } catch (e) { 
            console.error("Error loading tags:", e); 
            if (globalTagsContainer) globalTagsContainer.innerHTML = '<span style="color:red; font-size:11px;">Tag load failed.</span>';
            status.innerText = "Tag load failed.";
        }
    }

    async function filterFilesByTag(tag) {
        if (!globalTagMap[tag]) return;
        status.innerText = `Filtering by ${tag}...`;
        fileList.innerHTML = '<div style="padding:10px; color:#666; font-size:12px;">Searching...</div>';
        const fileIds = globalTagMap[tag];
        const files = await window.api.getFilesByIds(fileIds);
        fileList.innerHTML = '';
        if (files.length === 0) { fileList.innerHTML = '<div style="padding:10px; color:#999;">Files not found.</div>'; } 
        else { files.forEach(f => fileList.appendChild(createTreeItem(f))); }
        status.innerText = `Found ${files.length} files`;
    }
    if (refreshTagsBtn) refreshTagsBtn.onclick = () => { status.innerText = "Refreshing..."; loadGlobalTags(); };

    // SEARCH
    if (searchBox) {
        const SEARCH_TIMEOUT_MS = 8000;
        searchBox.addEventListener('input', () => {
            if (searchTimeout) clearTimeout(searchTimeout);
            if (searchBox.value.trim().length === 0) { init(); return; }
            searchTimeout = setTimeout(async () => {
                const query = searchBox.value.trim();
                const isTag = query.startsWith('#');
                status.innerText = `Searching...`;
                const searchPromise = window.api.searchFiles(isTag ? query.substring(1) : query, isTag || searchContentCheck.checked);
                const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Search timed out')), SEARCH_TIMEOUT_MS));
                let res = [];
                try {
                    res = await Promise.race([searchPromise, timeoutPromise]);
                } catch (err) {
                    console.error('Search failed:', err);
                    status.innerText = 'Search failed.';
                    if (fileList) fileList.innerHTML = '<div style="padding:10px; color:#999;">Search failed.</div>';
                    return;
                }
                fileList.innerHTML = '';
                res.forEach(f => fileList.appendChild(createTreeItem(f)));
                status.innerText = `Found ${res.length} results.`;
            }, 500);
        });
        if (searchClearBtn) {
            searchClearBtn.onclick = () => {
                searchBox.value = '';
                if (searchTimeout) clearTimeout(searchTimeout);
                init(); 
                searchBox.focus();
            };
        }
    }

    // SCANNER LOGIC
    async function performScan(fileId, mimeType) {
        if (!docStructure) return;
        currentScanItems = [];
        if (localTagsContainer) localTagsContainer.innerHTML = '';
        if (localTagsSection) localTagsSection.style.display = 'none';

        if (mimeType !== 'application/vnd.google-apps.document') { docStructure.innerHTML = ''; return; }
        docStructure.innerHTML = '<div style="padding:15px; color:#666; font-size:12px;">Scanning...</div>';
        try {
            const doc = await window.api.scanContent(fileId);
            if (!doc || !doc.doc) { docStructure.innerHTML = ''; return; }
            renderScanResults(doc, fileId);
        } catch (e) { docStructure.innerHTML = ''; }
    }

    function renderScanResults(scanData, fileId) {
        const { doc, comments } = scanData;
        docStructure.innerHTML = '';
        currentScanItems = [];
        let itemsFound = 0;
        let currentSection = { title: 'Top', id: '' };
        const uniqueLocalTags = new Set();

        function isNativeCheckbox(paragraph) {
            if (!paragraph.bullet || !doc.lists) return false;
            const listId = paragraph.bullet.listId;
            const level = paragraph.bullet.nestingLevel || 0;
            const list = doc.lists[listId];
            if (!list) return false;
            const glyph = list.listProperties?.nestingLevels?.[level]?.glyphType;
            return glyph === 'BULLET_CHECKBOX' || glyph === 'GLYPH_TYPE_UNSPECIFIED';
        }

        function scanContentList(contentList) {
            if (!contentList) return;
            contentList.forEach(element => {
                if (element.table) {
                    element.table.tableRows.forEach(row => {
                        row.tableCells.forEach(cell => scanContentList(cell.content));
                    });
                } else if (element.paragraph) {
                    processParagraph(element.paragraph);
                }
            });
        }

        function processParagraph(paragraph) {
            const style = paragraph.paragraphStyle?.namedStyleType;
            const textElements = paragraph.elements;
            let fullText = '';
            let isVisuallyStruck = false; 

            textElements.forEach(e => {
                if(e.textRun) {
                    fullText += e.textRun.content;
                    if(e.textRun.textStyle?.strikethrough) isVisuallyStruck = true;
                }
            });
            fullText = fullText.trim();
            if (!fullText) return;

            const textCheckedMatch = fullText.match(/^\[\s*[xX]\s*\]/); 
            const textUncheckedMatch = fullText.match(/^\[\s*\]/);
            const todoMatch = fullText.match(/^todo:/i);
            const isNative = isNativeCheckbox(paragraph);

            if (style && style.includes('HEADING')) {
                itemsFound++;
                const thisHeaderId = paragraph.paragraphStyle.headingId || '';
                currentSection = { title: fullText, id: thisHeaderId };
                
                const headEl = document.createElement('div');
                headEl.draggable = true;
                headEl.addEventListener('dragstart', (e) => {
                    const payload = {
                        type: 'section', sourceFileId: fileId, headerId: thisHeaderId, title: fullText    
                    };
                    const json = JSON.stringify(payload);
                    e.dataTransfer.setData('application/json', json);
                    e.dataTransfer.setData('text/plain', json); 
                    e.dataTransfer.effectAllowed = 'copyMove';
                    headEl.style.opacity = '0.5';
                });
                headEl.addEventListener('dragend', () => headEl.style.opacity = '1');
                headEl.style.cssText = "padding: 8px 15px; background: #e8f0fe; font-weight:bold; font-size:12px; color:#1967d2; border-top:1px solid #eee; margin-top:5px; cursor:pointer;";
                headEl.innerText = fullText;
                if(thisHeaderId) headEl.onclick = () => webview.src = `https://docs.google.com/document/d/${fileId}/edit#heading=${thisHeaderId}`;
                docStructure.appendChild(headEl);
            } 
            else if (isNative || textCheckedMatch || textUncheckedMatch || todoMatch) {
                itemsFound++;
                let cleanText = fullText.replace(/^\[\s*[xX]\s*\]/, '').replace(/^\[\s*\]/, '').replace(/^todo:/i, '').trim();
                const isDone = textCheckedMatch || isVisuallyStruck;
                
                const statusIcon = isDone ? 'VX' : '☐'; 
                const statusColor = isDone ? '#34a853' : '#ea4335';
                const textStyle = isDone ? 'text-decoration: line-through; color: #888;' : '';

                currentScanItems.push({ type: isDone ? 'Task (Done)' : 'Task', text: cleanText, headerId: currentSection.id });

                const taskEl = document.createElement('div');
                taskEl.style.cssText = "padding: 6px 15px; font-size:12px; border-bottom:1px solid #f0f0f0; display:flex; align-items:start;";
                taskEl.innerHTML = `<span style="margin-right:6px; color:${statusColor}; font-weight:bold;">${statusIcon}</span> <span style="${textStyle}">${cleanText}</span>`;
                docStructure.appendChild(taskEl);
            }
            else if (fullText.includes('#')) {
                const matches = fullText.match(/(#[a-zA-Z0-9-_]+)/g);
                if (matches) {
                    itemsFound++;
                    const tagRow = document.createElement('div');
                    tagRow.style.cssText = "padding: 6px 15px; font-size:12px; border-bottom:1px solid #f0f0f0;";
                    matches.forEach(tag => {
                        uniqueLocalTags.add(tag);
                        currentScanItems.push({ type: 'Tag', text: tag, headerId: currentSection.id });
                        const badge = document.createElement('span');
                        badge.innerText = tag;
                        badge.style.cssText = "background:#34a853; color:white; padding:2px 6px; border-radius:10px; font-size:10px; margin-right:4px;";
                        tagRow.appendChild(badge);
                    });
                    docStructure.appendChild(tagRow);
                }
            }
        }

        if (doc.body && doc.body.content) scanContentList(doc.body.content);
        if (doc.headers) Object.values(doc.headers).forEach(h => scanContentList(h.content));
        if (doc.footers) Object.values(doc.footers).forEach(f => scanContentList(f.content));
        
        if (comments && comments.length > 0) {
            const sep = document.createElement('div');
            sep.innerHTML = '<strong>💬 Comments</strong>';
            sep.style.cssText = "padding:8px 15px; background:#f1f3f4; font-size:11px; color:#5f6368; border-top:1px solid #ddd;";
            docStructure.appendChild(sep);
            comments.forEach(c => {
                 let text = c.content.trim();
                 if (!text) return;
                 if (text.toLowerCase().includes('todo:')) {
                     itemsFound++;
                     const clean = text.replace(/todo:/i, '').trim();
                     currentScanItems.push({ type: 'Task', text: `${clean} (Comment by ${c.author.displayName})`, headerId: '' });
                     const el = document.createElement('div');
                     el.style.cssText = "padding: 6px 15px; font-size:12px; border-bottom:1px solid #f0f0f0; color:#ea4335;";
                     el.innerHTML = `☐ ${clean} <em style="color:#999; font-size:10px;">- ${c.author.displayName}</em>`;
                     docStructure.appendChild(el);
                 }
            });
        }
        
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

        const btn = document.createElement('button');
        btn.id = 'manual-sync-btn';
        btn.innerText = "📥 Sync to Master Index";
        btn.style.cssText = "margin: 10px; width:calc(100% - 20px); padding:8px; background:#1a73e8; color:white; border:none; border-radius:4px; cursor:pointer;";
        btn.onclick = async () => {
            status.innerText = "Syncing...";
            await window.api.syncToSheet({ fileId, items: currentScanItems });
            status.innerText = "Synced!";
            loadGlobalTags();
        };
        docStructure.prepend(btn);
    }

    // CREATE TREE ITEM
    function createTreeItem(file) {
        const isRoot = file.id === 'root'; 
        const isRealFolder = file.mimeType === 'application/vnd.google-apps.folder';
        const isShortcut = file.mimeType === 'application/vnd.google-apps.shortcut';
        
        const isSectionLink = file.appProperties && file.appProperties.role === 'section_link';

        let isFolder = isRealFolder || isRoot; 
        if (isShortcut && file.shortcutDetails?.targetMimeType === 'application/vnd.google-apps.folder') isFolder = true;
        
        const node = document.createElement('div'); node.className = 'tree-node';
        node.dataset.id = file.id; 
        
        const currentParentId = (file.parents && file.parents.length > 0) ? file.parents[0] : 'root';
        node.dataset.parentId = currentParentId;

        const label = document.createElement('div'); label.className = 'tree-label'; 
        
        if (!isRoot) {
            label.draggable = true; 
        }
        
        const arrow = document.createElement('span'); arrow.className = 'tree-arrow'; arrow.innerText = isFolder ? '▶' : '';
        
        let icon = getIcon(file.mimeType);
        if (isRoot) icon = 'MyDrive'; 
        if (isSectionLink) icon = '🔖'; 
        
        if (isRoot) {
            label.innerHTML = `<span class="tree-icon">🏠</span><span style="font-weight:bold;">${file.name}</span>`;
        } else {
            label.innerHTML = `<span class="tree-icon">${icon}</span><span>${file.name}</span>`;
        }
        label.prepend(arrow);
        
        const children = document.createElement('div'); children.className = 'tree-children';
        node.appendChild(label); node.appendChild(children);

        label.onclick = async (e) => {
            e.stopPropagation();
            document.querySelectorAll('.tree-label').forEach(el => el.classList.remove('selected'));
            label.classList.add('selected');
            
            if (isSectionLink) {
                const srcId = file.appProperties.sourceFileId;
                const headId = file.appProperties.headerId;
                if (!srcId) return;
                status.innerText = `Jumping to section in "${file.name}"...`;
                let deepLink = `https://docs.google.com/document/d/${srcId}/edit`;
                if (headId) deepLink += `#heading=${headId}`;
                webview.src = deepLink;
                performScan(srcId, 'application/vnd.google-apps.document');
                return;
            }

            if (!isFolder) { openFile(file); return; }
            
            if (children.style.display === 'block') {
                children.style.display = 'none'; arrow.innerText = '▶'; arrow.classList.remove('rotated');
            } else {
                children.style.display = 'block'; arrow.innerText = '▼'; arrow.classList.add('rotated');
                if (children.children.length === 0) {
                    let searchId = file.id;
                    if (isShortcut && file.shortcutDetails) {
                        searchId = file.shortcutDetails.targetId;
                    }

                    const res = await window.api.listFiles(searchId);
                    if (res.length === 0) children.innerHTML = '<div style="padding-left:24px; font-size:12px; color:#999;">(empty)</div>';
                    else res.forEach(child => children.appendChild(createTreeItem(child)));
                }
            }
        };

        label.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            window.api.showContextMenu({ 
                name: file.name, link: file.webViewLink, isFolder: isFolder, 
                id: file.id, parentId: currentParentId, clipboardItem: clipboardItem, shortcutDetails: file.shortcutDetails
            });
        });

        if (!isRoot) {
            label.addEventListener('dragstart', (e) => {
                e.dataTransfer.setData('application/json', JSON.stringify({
                    id: file.id, name: file.name, parentId: currentParentId
                }));
                e.dataTransfer.effectAllowed = 'copyMove';
                label.style.opacity = '0.5';
            });
            label.addEventListener('dragend', () => label.style.opacity = '1');
        }

        if (isFolder) {
            label.addEventListener('dragover', (e) => { e.preventDefault(); label.classList.add('drag-over'); });
            label.addEventListener('dragleave', () => label.classList.remove('drag-over'));
            label.addEventListener('drop', async (e) => {
                e.preventDefault(); e.stopPropagation(); label.classList.remove('drag-over');
              const rawData = e.dataTransfer.getData('application/json') || e.dataTransfer.getData('text/plain');
              if (!rawData) return;
              const dragData = JSON.parse(rawData);

                if (dragData.type === 'section') {
                    const confirmLink = confirm(`Create a link to section "${dragData.title}" inside "${file.name}"?`);
                    if (!confirmLink) return;
                    status.innerText = `Linking "${dragData.title}"...`;
                    try {
                        await window.api.createSectionLink({
                            parentId: file.id,
                            name: dragData.title,
                            sourceFileId: dragData.sourceFileId,
                            headerId: dragData.headerId
                        });
                        status.innerText = "Link created!";
                        refreshFolder(file.id);
                    } catch (err) {
                        console.error(err);
                        status.innerText = "Creation failed.";
                    }
                    return;
                }

                if (dragData.id) {
                    if (dragData.id === file.id) return; 
                    if (dragData.parentId === file.id) return; 

                    const confirmMove = confirm(`Move "${dragData.name}" into "${file.name}"?`);
                    if (!confirmMove) return;

                    status.innerText = `Moving "${dragData.name}"...`;
                    try {
                        await window.api.moveFile({
                            fileId: dragData.id,
                            oldParentId: dragData.parentId || 'root',
                            newParentId: file.id
                        });
                        status.innerText = "Move successful!";
                        refreshFolder(file.id);
                        if (dragData.parentId && dragData.parentId !== file.id) {
                            refreshFolder(dragData.parentId);
                        }
                    } catch (err) {
                        console.error(err);
                        status.innerText = "Move failed.";
                    }
                }
            });
        }
        return node;
    }

    if (fileList) {
        fileList.addEventListener('dragover', (e) => e.preventDefault());
    }

    function openFile(file, mode = 'preview') {
        if (!file.webViewLink) return;
        let targetId = file.id; let targetMime = file.mimeType;
        if (file.mimeType.includes('shortcut') && file.shortcutDetails) { targetId = file.shortcutDetails.targetId; targetMime = file.shortcutDetails.targetMimeType; }
        currentFileId = targetId; currentFileName = file.name;
        status.innerText = `Loading: ${file.name}...`;
        let link = file.webViewLink;
        if (mode === 'edit') { link = link.replace(/\/view.*$/, '/edit').replace(/\/preview.*$/, '/edit'); } 
        else { link = link.replace(/\/edit.*$/, '/preview').replace(/\/view.*$/, '/preview'); }
        webview.src = link;
        addToRecents(file);
        performScan(targetId, targetMime);
    }

    // UTILS
    async function refreshFolder(folderId) {
        if (!folderId || folderId === 'root') { init(); return; }
        const folderNode = document.querySelector(`.tree-node[data-id="${folderId}"]`);
        if (!folderNode) return; 
        const childrenContainer = folderNode.querySelector('.tree-children');
        const arrow = folderNode.querySelector('.tree-arrow');
        const files = await window.api.listFiles(folderId);
        childrenContainer.innerHTML = '';
        if (files.length === 0) childrenContainer.innerHTML = '<div style="padding-left:24px; font-size:12px; color:#999;">(empty)</div>';
        else files.forEach(f => childrenContainer.appendChild(createTreeItem(f)));
        childrenContainer.style.display = 'block';
        arrow.innerText = '▼'; arrow.classList.add('rotated');
    }

    function addToRecents(file) {
        let recents = loadRecents().filter(f => f.id !== file.id);
        const pId = (file.parents && file.parents.length > 0) ? file.parents[0] : 'root';
        recents.unshift({ id: file.id, name: file.name, mimeType: file.mimeType, webViewLink: file.webViewLink, parentId: pId, shortcutDetails: file.shortcutDetails });
        if (recents.length > MAX_RECENT) recents = recents.slice(0, MAX_RECENT);
        saveRecents(recents);
    }
    function loadRecents() { const data = localStorage.getItem('recentFiles'); return data ? JSON.parse(data) : []; }
    function saveRecents(files) { localStorage.setItem('recentFiles', JSON.stringify(files)); renderRecents(); }
    function renderRecents() { 
        if(!recentList) return;
        recentList.innerHTML = '';
        const recents = loadRecents();
        if(recents.length === 0) { recentSection.style.display = 'none'; return; }
        
        // Only show if user hasn't collapsed it (default expanded)
        // ... (Skipped complex collapse logic for brevity, just rendering)
        recentSection.style.display = 'block';
        
        recents.forEach(f => {
            const div = document.createElement('div');
            div.style.cssText = "padding:4px 12px; font-size:12px; color:#1967d2; cursor:pointer; overflow:hidden; white-space:nowrap; text-overflow:ellipsis;";
            div.innerText = f.name;
            div.onclick = () => openFile(f);
            recentList.appendChild(div);
        });
    } 

    function getIcon(mimeType) {
        if (mimeType === 'application/vnd.google-apps.folder') return '📁';
        if (mimeType.includes('shortcut')) return '🔗'; 
        if (mimeType.includes('spreadsheet')) return '📊';
        if (mimeType.includes('document')) return '📝';
        if (mimeType.includes('pdf')) return '📕';
        return '📄';
    }

    function closeModal() { if (modal) modal.style.display = 'none'; pendingCreation = null; pendingRename = null; }
    if (cancelBtn) cancelBtn.onclick = closeModal;
    if (closeDetailsBtn) closeDetailsBtn.onclick = () => { detailsModal.style.display = 'none'; };
    if (createBtn) {
        createBtn.onclick = async () => {
            const name = nameInput.value.trim();
            if (pendingRename) {
                if (!name) return; status.innerText = "Renaming...";
                await window.api.renameFile({ fileId: pendingRename.id, newName: name });
                status.innerText = "Renamed!"; refreshFolder(pendingRename.parentId); closeModal(); return;
            }
            if (!name || !pendingCreation) return; 
            const folderId = pendingCreation.parentId; const fileType = pendingCreation.type; closeModal();
            let mimeType = 'application/vnd.google-apps.folder';
            if (fileType === 'doc') mimeType = 'application/vnd.google-apps.document';
            if (fileType === 'sheet') mimeType = 'application/vnd.google-apps.spreadsheet';
            status.innerText = "Creating file...";
            await window.api.createFile({ parentId: folderId, name: name, mimeType: mimeType });
            status.innerText = "Created!"; refreshFolder(folderId);
        };
    }
    if (nameInput) nameInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') createBtn.click(); });

    // INIT
    async function init() {
      const oldBtn = document.getElementById('login-btn'); if (oldBtn) oldBtn.remove();
      renderRecents();
      try {
        status.innerText = 'Checking connection...';
        const test = await window.api.listFiles('root');
        
        fileList.innerHTML = '';
        if (test) {
            status.innerText = 'Ready';
            const rootNode = createTreeItem({
                id: 'root',
                name: 'My Drive',
                mimeType: 'application/vnd.google-apps.folder',
                parents: [] 
            });
            fileList.appendChild(rootNode);
            const label = rootNode.querySelector('.tree-label');
            if(label) label.click(); 
            
            loadGlobalTags();
        } else {
            const btn = document.createElement('button'); btn.id = 'login-btn'; btn.innerText = "🔑 Sign In";
            btn.onclick = () => window.api.openWebLogin();
            fileList.appendChild(btn);
        }
      } catch (e) { status.innerText = 'Connection failed.'; }
    }
    
    if (window.api.onAuthSuccess) { window.api.onAuthSuccess(() => init()); }
    webview.addEventListener('ipc-message', (event) => { if (event.channel === 'header-context-menu') window.api.showHeaderMenu(event.args[0]); });

    init();
});