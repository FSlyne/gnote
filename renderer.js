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
    const loginBtn = document.getElementById('login-btn');

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

    // WEB LINK MODAL ELEMENTS
    const wlModal = document.getElementById('weblink-modal');
    const wlName = document.getElementById('wl-name');
    const wlUrl = document.getElementById('wl-url');
    const wlTags = document.getElementById('wl-tags');
    const wlNote = document.getElementById('wl-note');
    const wlCreateBtn = document.getElementById('wl-create-btn');
    const wlCancelBtn = document.getElementById('wl-cancel-btn');
    let pendingWebLinkParent = null;

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

    // =========================================================================
    // D. DASHBOARD LOGIC (New)
    // =========================================================================

    const dashboardTableBody = document.getElementById('dashboard-table-body');

    if (closeDashBtn) closeDashBtn.onclick = () => { dashboardView.style.display = 'none'; };
    if (dashboardBtn) dashboardBtn.onclick = () => openDashboard();

    const itemFilter = document.getElementById('item-filter');
    if (itemFilter) {
        itemFilter.onchange = () => renderDashboardRows(allItems);
    }

    let allItems = []; // Global for filtering

    function renderDashboardRows(items) {
        allItems = items || [];
        dashboardTableBody.innerHTML = '';
        if (!items || items.length === 0) {
            dashboardTableBody.innerHTML = '<tr><td colspan="3" style="padding:20px; text-align:center; color:#999;">No data found.</td></tr>';
            return;
        }

        const flatTasks = [];
        const dynamicTypes = new Set();

        // 1. Flatten for filtering first
        items.forEach(section => {
            // Tasks
            if (section.tasks) {
                section.tasks.forEach(t => flatTasks.push({ type: 'task', text: t.text, completed: t.completed, ...sectionProps(section) }));
            }
            // Todos
            if (section.todos) {
                section.todos.forEach(todo => {
                    const match = todo.match(/^([a-zA-Z0-9_\-]+)::\s*(.+)/);
                    let subType = 'todo';
                    if (match) {
                        const label = match[1].toLowerCase();
                        if (!['http', 'https', 'mailto'].includes(label)) {
                            subType = label;
                            dynamicTypes.add(label);
                        }
                    }
                    flatTasks.push({ type: subType, text: todo, completed: false, ...sectionProps(section) });
                });
            }
            // Tags
            if (section.tags) {
                section.tags.forEach(tag => flatTasks.push({ type: 'tag', text: tag, completed: false, ...sectionProps(section) }));
            }
        });

        function sectionProps(s) {
            return { fileId: s.fileId, fileName: s.fileName, headerId: s.headerId, headerText: s.headerText, date: s.fileUpdated, isWebLink: s.isWebLink };
        }

        // DYNAMIC FILTER UI (Keep existing logic)
        const filterSelect = document.getElementById('item-filter');
        if (filterSelect) {
            const currentVal = filterSelect.value || 'all';
            let opts = `<option value="all">📂 All Items</option>
                        <option value="task">⬜ Tasks</option>
                        <option value="tag">🏷️ Tags</option>`;
            if (dynamicTypes.size > 0) {
                opts += `<optgroup label="Markers">`;
                dynamicTypes.forEach(t => {
                    const label = t.charAt(0).toUpperCase() + t.slice(1);
                    opts += `<option value="${t}">📍 ${label}</option>`;
                });
                opts += `</optgroup>`;
            }
            if (filterSelect.innerHTML !== opts) {
                filterSelect.innerHTML = opts;
                if ([...filterSelect.options].some(o => o.value === currentVal)) filterSelect.value = currentVal;
                else filterSelect.value = 'all';
            }
        }

        // FILTER
        const filterVal = filterSelect ? filterSelect.value : 'all';
        const filteredTasks = flatTasks.filter(t => {
            if (filterVal === 'all') return true;
            if (filterVal === 'task') return t.type === 'task';
            if (filterVal === 'tag') return t.type === 'tag';
            return t.type === filterVal;
        });

        if (filteredTasks.length === 0) {
            dashboardTableBody.innerHTML = '<tr><td colspan="3" style="padding:20px; text-align:center; color:#999;">No items match filter.</td></tr>';
            return;
        }

        // 2. GROUPING logic
        // Structure: Map<FileID, { fileName, sections: Map<HeaderID, { headerText, tasks[] }> }>
        const groups = new Map();

        filteredTasks.forEach(task => {
            if (!groups.has(task.fileId)) {
                groups.set(task.fileId, {
                    fileName: task.fileName,
                    isWebLink: task.isWebLink,
                    sections: new Map()
                });
            }
            const fileGroup = groups.get(task.fileId);

            // For WebLinks, force header to 'Main' or hidden
            const headerKey = task.headerId || 'root';
            if (!fileGroup.sections.has(headerKey)) {
                fileGroup.sections.set(headerKey, {
                    headerText: task.headerText,
                    tasks: []
                });
            }
            fileGroup.sections.get(headerKey).tasks.push(task);
        });

        // 3. RENDER
        groups.forEach((fileGroup, fileId) => {
            // File Header
            const fileTr = document.createElement('tr');
            fileTr.innerHTML = `
                <td colspan="3" style="padding:10px 10px 5px 10px; background:#f8f9fa; border-top:1px solid #ddd; font-weight:bold; color:#3c4043;">
                    ${fileGroup.isWebLink ? '🔗' : '📄'} ${fileGroup.fileName}
                </td>`;
            dashboardTableBody.appendChild(fileTr);

            fileGroup.sections.forEach((res, headerId) => {
                // Section Header (only if not root/implicit or if distinct sections exist?)
                // Actually, if headerText exists and isn't file name repeating, or just always show for clarity?
                // For GDocs, headerText is usually the H1/H2.
                // For WebLinks, headerText 'root' or same as filename.

                const isRedundantHeader = (res.headerText === fileGroup.fileName) || (headerId === 'root');

                if (!isRedundantHeader) {
                    const secTr = document.createElement('tr');
                    secTr.innerHTML = `
                        <td colspan="3" style="padding:4px 10px 4px 25px; background:#fff; font-size:12px; color:#1a73e8; font-weight:500;">
                            # ${res.headerText}
                        </td>`;
                    dashboardTableBody.appendChild(secTr);
                }

                res.tasks.forEach(task => {
                    const tr = document.createElement('tr');
                    tr.style.borderBottom = '1px solid #eee';

                    // Icon & Style
                    let taskIcon = '📍';
                    let taskStyle = 'color:#202124; font-weight:500;';
                    if (task.type === 'task') {
                        taskIcon = task.completed ? '✅' : '⬜';
                        if (task.completed) taskStyle = 'color:#999; text-decoration:line-through;';
                    } else if (task.type === 'tag') {
                        taskIcon = '🏷️';
                        taskStyle = 'color:#1a73e8; background:#e8f0fe; padding:2px 8px; border-radius:12px; font-size:12px;';
                    } else {
                        taskIcon = '📝';
                        taskStyle = 'color:#e37400;';
                    }

                    const dateHtml = `<span style="font-size:11px; color:#666;">${new Date(task.date).toLocaleDateString()}</span>`;
                    const actionBtn = `<button class="open-link-btn" data-fid="${task.fileId}" data-hid="${task.headerId}" data-isweblink="${task.isWebLink || 'false'}" style="padding:4px 8px; cursor:pointer; border:1px solid #dadce0; background:white; border-radius:4px; font-size:11px;">Open ↗</button>`;

                    // Indent task if we had a section header? Or always indent a bit from file?
                    const indent = isRedundantHeader ? '20px' : '40px';

                    tr.innerHTML = `
                        <td style="padding:8px 10px 8px ${indent}; font-size:13px;">
                            <span style="${taskStyle}">${taskIcon} ${task.text}</span>
                        </td>
                        <td style="padding:8px 10px;">${dateHtml}</td>
                        <td style="padding:8px 10px;">${actionBtn}</td>
                     `;
                    dashboardTableBody.appendChild(tr);
                });
            });
        });

        // Attach listeners
        document.querySelectorAll('.open-link-btn').forEach(btn => {
            btn.onclick = async (e) => {
                const fid = e.target.getAttribute('data-fid');
                const hid = e.target.getAttribute('data-hid');
                const btnEl = e.target;
                const originalText = btnEl.innerText;

                btnEl.innerText = "Opening...";
                btnEl.disabled = true;

                try {
                    // Always fetch details to determine type (robust against stale index)
                    const info = await window.api.getFileDetails(fid);
                    const isWebLink = info.metadata.appProperties && info.metadata.appProperties.role === 'web_link';

                    if (isWebLink) {
                        // Open Edit Modal
                        const fileData = {
                            id: info.metadata.id,
                            name: info.metadata.name,
                            parentId: (info.metadata.parents && info.metadata.parents.length) ? info.metadata.parents[0] : 'root',
                            appProperties: info.metadata.appProperties || {}
                        };

                        pendingWebLinkEdit = fileData;
                        pendingWebLinkParent = null;
                        if (wlModal) {
                            wlModal.style.display = 'flex';
                            wlName.value = fileData.name || '';
                            const ap = fileData.appProperties;
                            wlUrl.value = ap.url || '';
                            wlNote.value = ap.note || '';
                            let tagStr = '';
                            try { tagStr = JSON.parse(ap.tags || '[]').join(', '); } catch (e) { }
                            wlTags.value = tagStr;
                            if (wlCreateBtn) wlCreateBtn.innerText = "Save Changes";
                            wlName.focus();
                        }
                        dashboardView.style.display = 'none';
                    } else {
                        // Normal Doc Link
                        const deepLink = `https://docs.google.com/document/d/${fid}/edit#heading=${hid}`;
                        webview.src = deepLink;
                        dashboardView.style.display = 'none';
                    }
                } catch (err) {
                    console.error("Open failed:", err);
                    alert("Failed to open item: " + err.message);
                } finally {
                    btnEl.innerText = originalText;
                    btnEl.disabled = false;
                }
            };
        });
    }

    async function openDashboard() {
        dashboardView.style.display = 'flex';
        dashboardTableBody.innerHTML = '<tr><td colspan="5" style="padding:20px; text-align:center; color:#666;">Loading tasks...</td></tr>';

        // SMART SYNC: Update current file immediately so changes appear
        if (currentFileId) {
            try {
                await window.api.indexFile(currentFileId);
            } catch (e) {
                console.warn("SmartSync on open failed:", e);
            }
        }

        // ALWAYS Load Index (to show fresh data)
        try {
            const res = await window.api.loadIndex();
            if (res && res.success && res.data.length > 0) {
                renderDashboardRows(res.data);
                // Update global items reference for filtering
                allItems = res.data;
            } else {
                dashboardTableBody.innerHTML = '<tr><td colspan="5" style="padding:20px; text-align:center; color:#999;">Index is empty. Click <b>Refresh Index</b> to scan your docs.</td></tr>';
            }
        } catch (e) {
            console.error("Failed to load index:", e);
            dashboardTableBody.innerHTML = '<tr><td colspan="5" style="padding:20px; text-align:center; color:#d93025;">Error loading index.</td></tr>';
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
        if (!graphView) return;
        graphView.style.display = 'block';
        const nodes = []; const edges = []; const processedFiles = new Set();
        Object.keys(globalTagMap).forEach((tag) => {
            nodes.push({ id: tag, label: tag, color: '#34a853', shape: 'hexagon', size: 20, font: { color: 'white' } });
            globalTagMap[tag].forEach(fileId => {
                if (!processedFiles.has(fileId)) {
                    nodes.push({ id: fileId, label: 'File ' + fileId.substr(0, 4), color: '#4285f4', shape: 'dot', size: 10 });
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
    if (loginBtn) {
        loginBtn.onclick = async () => {
            status.innerText = "Launching Google Login...";
            console.log("Renderer: Requesting openWebLogin...");
            try {
                const result = await window.api.openWebLogin();
                if (result && result.success) {
                    status.innerText = "Please check your browser to login.";
                } else {
                    const errorMsg = result.error || "Unknown error";
                    status.innerText = "Login failed: " + errorMsg;
                    if (errorMsg.includes('Port 10000')) {
                        alert("Login Error: Port 10000 is busy.\n\nRunning multiple copies of GNote?\nPlease close them and try again.");
                    } else {
                        alert("Login Error: " + errorMsg);
                    }
                }
            } catch (err) {
                status.innerText = "IPC Error: " + err.message;
                alert("IPC Error: " + err.message);
            }
        };
    }

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
                status.innerText = `Analyzing ${data.name}...`;

                try {
                    // Call AI (Backend handles fetching)
                    const result = await window.api.processWithAI({
                        fileId: data.id,
                        promptType: 'summarize'
                    });

                    if (result.error === 'QUOTA_EXCEEDED') {
                        const msg = `Quota Limit Reached. Please wait ${result.retryDelay}s.`;
                        status.innerText = msg;
                        alert(msg + "\n\n(You are on the free tier of the Gemini API)");
                        return;
                    }

                    if (result.error) throw new Error(result.error);

                    // Show Result
                    detailsTitle.innerText = `✨ AI Summary: ${data.name}`;
                    const htmlContent = window.api.parseMarkdown(result.text || "No response.");
                    metaTable.innerHTML = `<div style="padding:20px; line-height:1.6; font-size:14px; color:#333;">${htmlContent}</div>`;

                    if (versionsContainer) versionsContainer.style.display = 'none'; // Hide versions
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

            if (action === 'create-weblink') {
                pendingWebLinkParent = data.parentId;
                pendingWebLinkEdit = null; // Clear edit mode
                if (wlModal) {
                    wlModal.style.display = 'flex';
                    wlName.value = ''; wlUrl.value = ''; wlTags.value = ''; wlNote.value = '';
                    if (wlCreateBtn) wlCreateBtn.innerText = "Create Link";
                    wlName.focus();
                }
            }

            if (action === 'edit-weblink') {
                pendingWebLinkEdit = data;
                pendingWebLinkParent = null; // Not strictly needed for edit but good hygiene
                if (wlModal) {
                    wlModal.style.display = 'flex';
                    wlName.value = data.name || '';

                    const ap = data.appProperties || {};
                    wlUrl.value = ap.url || '';
                    wlNote.value = ap.note || '';

                    let tagStr = '';
                    try { tagStr = JSON.parse(ap.tags || '[]').join(', '); } catch (e) { }
                    wlTags.value = tagStr;

                    if (wlCreateBtn) wlCreateBtn.innerText = "Save Changes";
                    wlName.focus();
                }
            }

            if (action === 'details') {
                if (!detailsModal) return;
                detailsTitle.innerText = `Loading: ${data.name}...`; detailsModal.style.display = 'flex';
                metaTable.innerHTML = '';
                if (versionsContainer) versionsContainer.style.display = 'block';
                versionsList.innerHTML = 'Fetching versions...';

                try {
                    const info = await window.api.getFileDetails(data.id);
                    detailsTitle.innerText = info.metadata.name;
                    const pathString = info.metadata.fullPath || '-';

                    let extraRows = '';
                    if (info.metadata.appProperties && info.metadata.appProperties.role === 'web_link') {
                        const ap = info.metadata.appProperties;
                        let tagsHtml = '';
                        try {
                            const tags = JSON.parse(ap.tags || '[]');
                            tagsHtml = tags.map(t => `<span style="background:#e8f0fe; padding:2px 6px; border-radius:4px; margin-right:4px;">${t}</span>`).join('');
                        } catch (e) { }

                        extraRows = `
                            <tr><td colspan="2" style="border-top:1px solid #eee; padding-top:10px; font-weight:bold; color:#1967d2;">Web Link Details</td></tr>
                            <tr><td style="padding:5px;">URL</td><td><a href="#" onclick="window.api.openExternal('${ap.url}')">${ap.url}</a></td></tr>
                            <tr><td style="padding:5px;">Tags</td><td>${tagsHtml || '-'}</td></tr>
                            <tr><td style="padding:5px; vertical-align:top;">Note</td><td style="white-space:pre-wrap;">${ap.note || '-'}</td></tr>
                         `;
                    }

                    metaTable.innerHTML = `
                        <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
                        <tr><td style="padding:5px;">Type</td><td>${info.metadata.mimeType}</td></tr>
                        <tr><td style="padding:5px;">Size</td><td>${info.metadata.size || '-'}</td></tr>
                        <tr><td style="padding:5px;">Location</td><td title="${pathString}">${pathString}</td></tr>
                        ${extraRows}
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
            status.innerText = "Thinking...";

            try {
                // Send to API (Backend handles fetching)
                const result = await window.api.processWithAI({
                    fileId: pendingAIFile.id,
                    promptType: 'ask',
                    userQuery: userQuestion
                });

                if (result.error) throw new Error(result.error);

                // Display Result
                detailsTitle.innerText = `❓ Question: ${userQuestion}`;
                const htmlContent = window.api.parseMarkdown(result.text || "No response.");

                metaTable.innerHTML = `
                        <div style="padding:20px; font-size:14px; color:#333;">
                            <div style="margin-bottom:10px; color:#666; font-size:12px;">Answer based on <strong>${pendingAIFile.name}</strong>:</div>
                            <div style="line-height:1.6;">${htmlContent}</div>
                        </div>
                    `;
                if (versionsContainer) versionsContainer.style.display = 'none';
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
            if (globalTagsContainer) {
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
                if (e.textRun) {
                    fullText += e.textRun.content;
                    if (e.textRun.textStyle?.strikethrough) isVisuallyStruck = true;
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
                if (thisHeaderId) headEl.onclick = () => webview.src = `https://docs.google.com/document/d/${fileId}/edit#heading=${thisHeaderId}`;
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
        if (file.appProperties && file.appProperties.role === 'web_link') icon = '🌐';

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

            if (file.appProperties && file.appProperties.role === 'web_link') {
                const url = file.appProperties.url;
                if (!url) return;
                status.innerText = `Opening Link: ${file.name}...`;
                window.api.openExternal(url);
                return;
            }

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

            if (!isFolder) { openFile(file, 'preview', false); return; }

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
            console.log('Renderer: Context Menu for', file.name, 'Props:', file.appProperties);
            window.api.showContextMenu({
                name: file.name, link: file.webViewLink, isFolder: isFolder,
                id: file.id, parentId: currentParentId, clipboardItem: clipboardItem, shortcutDetails: file.shortcutDetails,
                appProperties: file.appProperties
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

    async function revealInTree(file) {
        // 1. Get full path IDs
        try {
            const details = await window.api.getFileDetails(file.id);
            if (!details || !details.metadata.pathIds) return;

            const pathIds = details.metadata.pathIds;

            // 2. Reset Search if needed
            if (searchBox.value.trim() !== '') {
                searchBox.value = '';
                await init(); // Restore root tree
            }

            // 3. Traverse and Expand
            // Start from root (index 0) down to parent
            for (const parentId of pathIds) {
                if (parentId === 'root') continue; // Root is always open

                const parentNode = document.querySelector(`.tree-node[data-id="${parentId}"]`);
                if (parentNode) {
                    const children = parentNode.querySelector('.tree-children');
                    const arrow = parentNode.querySelector('.tree-arrow');

                    // If collapsed or empty, expand/refresh
                    if (children.style.display !== 'block' || children.children.length === 0) {
                        children.style.display = 'block';
                        arrow.innerText = '▼'; arrow.classList.add('rotated');
                        // Only refresh if empty (lazy load)
                        if (children.children.length === 0) {
                            await refreshFolder(parentId);
                        }
                    }
                }
            }

            // 4. Highlight File
            setTimeout(() => {
                const targetNode = document.querySelector(`.tree-node[data-id="${file.id}"] > .tree-label`);
                if (targetNode) {
                    document.querySelectorAll('.tree-label').forEach(el => el.classList.remove('selected'));
                    targetNode.classList.add('selected');
                    targetNode.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
            }, 100);

        } catch (e) { console.error("Reveal failed:", e); }
    }

    function openFile(file, mode = 'preview', reveal = false) {
        if (!file.webViewLink) return;
        let targetId = file.id; let targetMime = file.mimeType;
        if (file.mimeType.includes('shortcut') && file.shortcutDetails) { targetId = file.shortcutDetails.targetId; targetMime = file.shortcutDetails.targetMimeType; }

        // SMART SYNC: Index the previous file in background
        if (currentFileId && currentFileId !== targetId) {
            console.log(`SmartSync: Triggering background index for ${currentFileId}`);
            window.api.indexFile(currentFileId).then(res => {
                if (res.success) console.log(`SmartSync Success for ${currentFileName}`);
                else console.warn(`SmartSync Failed:`, res.error);
            });
        }

        currentFileId = targetId; currentFileName = file.name;
        status.innerText = `Loading: ${file.name}...`;
        let link = file.webViewLink;
        if (mode === 'edit') { link = link.replace(/\/view.*$/, '/edit').replace(/\/preview.*$/, '/edit'); }
        else { link = link.replace(/\/edit.*$/, '/preview').replace(/\/view.*$/, '/preview'); }
        webview.src = link;
        addToRecents(file);
        performScan(targetId, targetMime);

        if (reveal) {
            revealInTree(file);
        }
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
        if (!recentList) return;
        recentList.innerHTML = '';
        const recents = loadRecents();
        if (recents.length === 0) { recentSection.style.display = 'none'; return; }

        recentSection.style.display = 'block';

        // Restore collapse state
        const isCollapsed = localStorage.getItem('recentCollapsed') === 'true';
        recentList.style.display = isCollapsed ? 'none' : 'block';
        if (recentArrow) {
            recentArrow.innerText = isCollapsed ? '▶' : '▼';
            if (isCollapsed) recentArrow.classList.remove('rotated');
            else recentArrow.classList.add('rotated');
        }

        // Bind Toggle
        if (recentHeader) {
            recentHeader.onclick = () => {
                const current = recentList.style.display === 'none';
                // If it IS hidden (current=true), we want to SHOW it (display block) => collapsed=false
                // If it IS showing (current=false), we want to HIDE it (display none) => collapsed=true
                const newState = !current;

                recentList.style.display = current ? 'block' : 'none';
                recentArrow.innerText = current ? '▼' : '▶';

                if (current) recentArrow.classList.add('rotated');
                else recentArrow.classList.remove('rotated');

                localStorage.setItem('recentCollapsed', !current);
            };
        }

        recents.forEach(f => {
            const div = document.createElement('div');
            div.style.cssText = "padding:4px 12px; font-size:12px; color:#1967d2; cursor:pointer; overflow:hidden; white-space:nowrap; text-overflow:ellipsis;";
            div.innerText = f.name;
            div.onclick = () => openFile(f, 'edit', true); // TRUE for reveal
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
            console.log('Renderer: Invoking listFiles for root...');

            // Timeout promise to prevent hanging
            const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('Init Timed Out')), 5000));
            const listPromise = window.api.listFiles('root');

            const test = await Promise.race([listPromise, timeout]);
            console.log('Renderer: listFiles returned', test ? test.length : 'null');

            fileList.innerHTML = '';
            if (test && test.length > 0) {
                status.innerText = 'Ready';
                const rootNode = createTreeItem({
                    id: 'root',
                    name: 'My Drive',
                    mimeType: 'application/vnd.google-apps.folder',
                    parents: []
                });

                fileList.appendChild(rootNode);
                // Expand root
                const label = rootNode.querySelector('.tree-label');
                if (label) label.click();

                loadGlobalTags();
            } else {
                status.innerText = 'Access required.';
                fileList.innerHTML = '<div style="padding:20px; text-align:center; color:#666;">Please sign in to access Google Drive.</div>';

                if (!document.getElementById('login-btn')) {
                    const btn = document.createElement('button'); btn.id = 'login-btn'; btn.innerText = "🔑 Sign In with Google";
                    btn.style.cssText = "margin-top:10px; padding:8px 16px; background:#1a73e8; color:white; border:none; border-radius:4px; cursor:pointer;";
                    btn.onclick = async () => {
                        status.innerText = "Launching Login...";
                        const res = await window.api.openWebLogin();
                        if (!res || !res.success) alert("Login failed: " + (res.error || 'Unknown'));
                    };
                    fileList.appendChild(btn);
                }
            }
        } catch (e) {
            console.error('Renderer: Init failed:', e);
            status.innerText = 'Connection check failed: ' + e.message;
            // Fallback button
            if (!document.getElementById('login-btn')) {
                const btn = document.createElement('button'); btn.id = 'login-btn'; btn.innerText = "🔑 Retry Login";
                btn.style.cssText = "margin:10px; padding:8px; display:block;";
                btn.onclick = () => window.api.openWebLogin();
                fileList.appendChild(btn);
            }
        }
    }


    if (window.api.onAuthSuccess) {
        window.api.onAuthSuccess(() => {
            console.log('Renderer: Auth success event received. Re-initializing...');
            status.innerText = "Login successful! Loading files...";
            init();
        });
    }

    // Handle header menu from webview
    if (webview) {
        webview.addEventListener('ipc-message', (event) => {
            if (event.channel === 'header-context-menu') window.api.showHeaderMenu(event.args[0]);
        });
    }

    // =========================================================================
    // WEB LINK MODAL LOGIC (Restored)
    // =========================================================================

    // Add pendingEdit state
    let pendingWebLinkEdit = null;

    const wlLaunchBtn = document.getElementById('wl-launch-btn');
    if (wlLaunchBtn) wlLaunchBtn.onclick = () => {
        const url = wlUrl.value.trim();
        if (url) window.api.openExternal(url);
    };

    if (wlCancelBtn) wlCancelBtn.onclick = () => { wlModal.style.display = 'none'; pendingWebLinkEdit = null; };
    if (wlCreateBtn) {
        wlCreateBtn.onclick = async () => {
            console.log('Renderer: Web Link Save Clicked');
            const name = wlName.value.trim();
            const url = wlUrl.value.trim();
            const note = wlNote.value.trim();
            const tags = wlTags.value.split(',').map(t => t.trim()).filter(t => t);

            if (!name || !url) { alert("Name and URL are required!"); return; }

            wlModal.style.display = 'none';

            if (pendingWebLinkEdit) {
                status.innerText = "Updating Link...";
                try {
                    await window.api.updateWebLink({
                        fileId: pendingWebLinkEdit.id,
                        name, url, note, tags
                    });
                    // SMART SYNC: Index immediately
                    await window.api.indexFile(pendingWebLinkEdit.id);

                    status.innerText = "Web Link Updated!";
                    refreshFolder(pendingWebLinkParent || pendingWebLinkEdit.parentId || 'root');
                } catch (err) {
                    console.error(err);
                    status.innerText = "Update failed.";
                    alert("Error: " + err.message);
                }
                pendingWebLinkEdit = null;
                return;
            }

            status.innerText = "Creating Link...";

            try {
                console.log('Renderer: Calling createWebLink', { pendingWebLinkParent, name, url });
                const newFile = await window.api.createWebLink({
                    parentId: pendingWebLinkParent || 'root',
                    name, url, note, tags
                });
                // SMART SYNC: Index immediately (if newFile contains ID)
                if (newFile && newFile.id) await window.api.indexFile(newFile.id);

                status.innerText = "Web Link Created!";
                refreshFolder(pendingWebLinkParent || 'root');
            } catch (err) {
                console.error(err);
                status.innerText = "Creation failed.";
                alert("Error: " + err.message);
            }
        };
    }

    init();
    // Listen for Protocol Launch (e.g. from Chrome)
    window.api.onOpenWebLinkModal((data) => {
        if (wlModal) {
            dashboardView.style.display = 'none'; // Ensure dashboard off if it interferes (optional)
            wlModal.style.display = 'flex';
            wlName.value = data.title || '';
            wlUrl.value = data.url || '';
            wlNote.value = data.note || '';
            wlTags.value = '';

            // Reset Edit Mode
            pendingWebLinkEdit = null;
            pendingWebLinkParent = null;
            if (wlCreateBtn) wlCreateBtn.innerText = "Create Link";

            // Focus Tags since Name/URL are filled
            wlTags.focus();
        }
    });

});