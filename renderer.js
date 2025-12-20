document.addEventListener('DOMContentLoaded', () => {
    
    // =========================================================================
    // 1. DOM ELEMENTS
    // =========================================================================
    
    // MAIN LAYOUT
    const sidebar = document.getElementById('sidebar');
    const viewer = document.getElementById('viewer');
    const webview = document.getElementById('doc-view');
    const status = document.getElementById('status');

    // RESIZABLE RIGHT PANE
    const scannerPane = document.getElementById('scanner-pane'); 
    const dragHandle = document.getElementById('drag-handle');
    const togglePaneBtn = document.getElementById('toggle-pane-btn');

    // LEFT SIDEBAR TOOLS
    const fileList = document.getElementById('file-list');
    const recentSection = document.getElementById('recent-section');
    const recentList = document.getElementById('recent-list');
    const recentHeader = document.getElementById('recent-header');
    const recentArrow = document.getElementById('recent-arrow');
    const searchBox = document.getElementById('search-box');
    const searchContentCheck = document.getElementById('search-content-check');
    const tagFilter = document.getElementById('tag-filter');
    const dailyBtn = document.getElementById('daily-btn');
    const dashboardBtn = document.getElementById('dashboard-btn');
    
    // RIGHT SIDEBAR CONTENT
    const localTagsSection = document.getElementById('local-tags-section');
    const localTagsContainer = document.getElementById('local-tags-container');
    const docStructure = document.getElementById('doc-structure');
    const globalTagsContainer = document.getElementById('global-tags-container');
    const refreshTagsBtn = document.getElementById('refresh-tags-btn');

    // DASHBOARD OVERLAY
    const dashboardView = document.getElementById('dashboard-view');
    const dashboardTable = document.getElementById('dashboard-table-body');
    const closeDashBtn = document.getElementById('close-dash-btn');

    // GRAPH VIEW
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
    const closeDetailsBtn = document.getElementById('close-details-btn');

    // =========================================================================
    // 2. STATE MANAGEMENT
    // =========================================================================
    
    let searchTimeout = null;
    let pendingCreation = null;
    let pendingRename = null; // NEW: Track rename state
    let isRecentExpanded = true;
    let isResizing = false;
    
    // Clipboard State
    // format: { id, name, parentId, mode: 'move'|'shortcut' }
    let clipboardItem = null; 
    
    // Current File Data
    let currentFileId = null;
    let currentFileName = null;
    let currentScanItems = [];
    
    // Global Data
    let globalTagMap = {}; 

    const MAX_RECENT = 10;

    // =========================================================================
    // 3. LAYOUT LOGIC (Resize & Toggle)
    // =========================================================================

    // Toggle Right Pane
    if (togglePaneBtn && scannerPane) {
        togglePaneBtn.onclick = () => {
            const isHidden = scannerPane.style.display === 'none';
            scannerPane.style.display = isHidden ? 'flex' : 'none';
            if (dragHandle) dragHandle.style.display = isHidden ? 'block' : 'none';
            togglePaneBtn.innerHTML = isHidden ? '👁️' : '🚫'; 
        };
    }

    // Drag Resize Logic
    if (dragHandle && scannerPane) {
        dragHandle.addEventListener('mousedown', (e) => {
            e.preventDefault(); 
            isResizing = true;
            dragHandle.classList.add('active');
            if (webview) webview.style.pointerEvents = 'none';
            document.body.style.userSelect = 'none';
            document.body.style.cursor = 'col-resize';
        });

        document.addEventListener('mousemove', (e) => {
            if (!isResizing) return;
            const newWidth = window.innerWidth - e.clientX;
            if (newWidth > 150 && newWidth < 600) {
                scannerPane.style.width = `${newWidth}px`;
            }
        });

        document.addEventListener('mouseup', () => {
            if (isResizing) {
                isResizing = false;
                dragHandle.classList.remove('active');
                if (webview) webview.style.pointerEvents = 'auto';
                document.body.style.userSelect = ''; 
                document.body.style.cursor = '';     
            }
        });
    }

    // =========================================================================
    // 4. WEBVIEW HANDLERS
    // =========================================================================
    if (webview) {
        webview.addEventListener('render-process-gone', (e) => {
            console.warn("Webview crashed:", e.reason);
            status.innerText = "Viewer crashed. Please select the file again.";
        });
        
        webview.addEventListener('did-fail-load', (e) => {
            if (e.errorCode !== -3) { 
                console.error("Load failed:", e.errorDescription, "Code:", e.errorCode);
                status.innerText = "Error loading doc.";
            }
        });

        webview.addEventListener('did-finish-load', () => {
            if (status.innerText.includes('Loading') || status.innerText.includes('Opened Diary')) {
                status.innerText = 'Ready';
            }
        });

        // 1. Intercept "New Window" clicks (standard Google Doc links)
        webview.addEventListener('new-window', (e) => {
            // STOP the internal popup
            e.preventDefault(); 
            
            const url = e.url;
            console.log("Link Clicked:", url); // Debug log
            
            // Send to real browser
            if (url.startsWith('http')) {
                status.innerText = `Opening link...`;
                window.api.openExternal(url); 
            }
        });

        // 2. Intercept direct navigation (just in case)
        webview.addEventListener('will-navigate', (e) => {
            const url = e.url;
            // If the user tries to click a link that isn't Google Docs/Drive/Login
            if (url.startsWith('http') && !url.includes('google.com')) {
                e.preventDefault();
                window.api.openExternal(url);
            }
        });
    }

    // =========================================================================
    // 5. GLOBAL TAGS & FILTERING
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
            pill.onclick = () => filterFilesByTag(tag);
            globalTagsContainer.appendChild(pill);
        });
    }

    function renderTagDropdown() {
        if (!tagFilter) return;
        tagFilter.innerHTML = '<option value="">📂 All Files</option>';
        const tags = Object.keys(globalTagMap).sort();
        
        tags.forEach(tag => {
            const opt = document.createElement('option');
            opt.value = tag;
            opt.innerText = `${tag} (${globalTagMap[tag].length})`;
            tagFilter.appendChild(opt);
        });
        
        tagFilter.onchange = () => {
            if (tagFilter.value === "") init();
            else filterFilesByTag(tagFilter.value);
        };
    }

    async function filterFilesByTag(tag) {
        if (!globalTagMap[tag]) return;
        if(tagFilter) tagFilter.value = tag;
        
        status.innerText = `Filtering by ${tag}...`;
        fileList.innerHTML = '<div style="padding:10px; color:#666; font-size:12px;">Searching...</div>';
        
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

    if (refreshTagsBtn) {
        refreshTagsBtn.onclick = () => {
            status.innerText = "Refreshing Tag Index...";
            loadGlobalTags();
        };
    }

    // =========================================================================
    // 6. SCANNER LOGIC (With Header Dragging for Links)
    // =========================================================================

// [renderer.js] - Replace 'performScan' and 'renderScanResults'

    async function performScan(fileId, mimeType) {
        if (!docStructure) return;
        
        currentScanItems = [];
        if (localTagsContainer) localTagsContainer.innerHTML = '';
        if (localTagsSection) localTagsSection.style.display = 'none';

        if (mimeType !== 'application/vnd.google-apps.document') {
            docStructure.innerHTML = `<div style="padding:15px; color:#ccc; font-size:12px;">Scanner ignored type:<br>${mimeType}<br><br>(Only Google Docs supported)</div>`;
            return;
        }

        docStructure.innerHTML = '<div style="padding:15px; color:#666; font-size:12px;">Scanning full structure...</div>';

        try {
            const result = await window.api.scanContent(fileId);
            if (!result || !result.doc) {
                docStructure.innerHTML = '<div style="padding:15px; color:#ccc; font-size:12px;">Could not read content.</div>';
                return;
            }
            renderScanResults(result, fileId);
        } catch (e) {
            console.error(e);
            docStructure.innerHTML = '<div style="padding:15px; color:red; font-size:12px;">Scan failed.</div>';
        }
    }

    function renderScanResults(scanData, fileId) {
        const { doc, comments } = scanData;
        docStructure.innerHTML = '';
        currentScanItems = [];
        
        let itemsFound = 0;
        const uniqueLocalTags = new Set();
        let currentSection = { title: 'Top', id: '' };

        // Helper: Check if a paragraph is a native Google Docs Checklist
        function isNativeCheckbox(paragraph) {
            if (!paragraph.bullet || !doc.lists) return false;
            const listId = paragraph.bullet.listId;
            const level = paragraph.bullet.nestingLevel || 0;
            const list = doc.lists[listId];
            
            if (!list) return false;
            
            // Check glyph type. 'BULLET_CHECKBOX' is definitive.
            // 'GLYPH_TYPE_UNSPECIFIED' is also common for checklists created via UI.
            const glyph = list.listProperties?.nestingLevels?.[level]?.glyphType;
            return glyph === 'BULLET_CHECKBOX' || glyph === 'GLYPH_TYPE_UNSPECIFIED';
        }

        // Recursive scanner for tables/footnotes/body
        function scanContentList(contentList) {
            if (!contentList) return;
            
            contentList.forEach(element => {
                // 1. RECURSE INTO TABLES
                if (element.table) {
                    element.table.tableRows.forEach(row => {
                        row.tableCells.forEach(cell => {
                            scanContentList(cell.content);
                        });
                    });
                }
                // 2. PROCESS PARAGRAPHS
                else if (element.paragraph) {
                    processParagraph(element.paragraph);
                }
            });
        }

function processParagraph(paragraph) {
            const style = paragraph.paragraphStyle?.namedStyleType;
            const textElements = paragraph.elements;
            
            // Reconstruct text
            let fullText = '';
            let isVisuallyStruck = false; 

            textElements.forEach(e => {
                if(e.textRun) {
                    fullText += e.textRun.content;
                    // Check if user manually applied strikethrough (API reliable)
                    if(e.textRun.textStyle?.strikethrough) isVisuallyStruck = true;
                }
            });
            fullText = fullText.trim();
            if (!fullText) return;

            // --- DETECT PATTERNS ---
            // 1. [x] or [X] -> Done
            const textCheckedMatch = fullText.match(/^\[\s*[xX]\s*\]/); 
            // 2. [] or [ ] -> Open
            const textUncheckedMatch = fullText.match(/^\[\s*\]/);
            // 3. todo: -> Open
            const todoMatch = fullText.match(/^todo:/i);
            // 4. Native Smart Checkbox (Status is usually hidden from API)
            const isNative = isNativeCheckbox(paragraph);

            // -- A. HEADING --
            if (style && style.includes('HEADING')) {
                // ... (Keep existing Heading logic) ...
                itemsFound++;
                const thisHeaderId = paragraph.paragraphStyle.headingId || '';
                currentSection = { title: fullText, id: thisHeaderId };
                
                const headEl = document.createElement('div');
                headEl.draggable = true;
                headEl.addEventListener('dragstart', (e) => {
                    e.dataTransfer.setData('application/json', JSON.stringify({
                        type: 'section', sourceFileId: fileId, headerId: thisHeaderId, title: fullText    
                    }));
                    e.dataTransfer.effectAllowed = 'all'; 
                    headEl.style.opacity = '0.5';
                });
                headEl.addEventListener('dragend', () => headEl.style.opacity = '1');
                headEl.style.cssText = "padding: 8px 15px; background: #e8f0fe; font-weight:bold; font-size:12px; color:#1967d2; border-top:1px solid #eee; margin-top:5px; cursor:pointer;";
                headEl.innerText = fullText;
                if(thisHeaderId) headEl.onclick = () => webview.src = `https://docs.google.com/document/d/${fileId}/edit#heading=${thisHeaderId}`;
                docStructure.appendChild(headEl);
            } 
            
            // -- B. TASKS --
            else if (isNative || textCheckedMatch || textUncheckedMatch || todoMatch) {
                itemsFound++;
                
                // CLEAN THE TEXT
                let cleanText = fullText
                    .replace(/^\[\s*[xX]\s*\]/, '') // Remove [x]
                    .replace(/^\[\s*\]/, '')       // Remove []
                    .replace(/^todo:/i, '')        // Remove todo:
                    .trim();

                // DETERMINE STATUS
                // Trust [x] or manual strikethrough. Native checkboxes unfortunately default to false due to API limits.
                const isDone = textCheckedMatch || isVisuallyStruck;
                
                const statusIcon = isDone ? 'VX' : '☐'; 
                const statusColor = isDone ? '#34a853' : '#ea4335';
                const textStyle = isDone ? 'text-decoration: line-through; color: #888;' : '';

                currentScanItems.push({ type: isDone ? 'Task (Done)' : 'Task', text: cleanText, headerId: currentSection.id });

                const taskEl = document.createElement('div');
                taskEl.style.cssText = "padding: 6px 15px; font-size:12px; border-bottom:1px solid #f0f0f0; display:flex; align-items:start;";
                
                // Add a small hint for native checkboxes that they might be "lying"
                let titleHint = isNative ? 'Note: Native checkbox status is not visible to the API' : '';

                taskEl.innerHTML = `<span title="${titleHint}" style="margin-right:6px; color:${statusColor}; font-weight:bold; cursor:help;">${statusIcon}</span> <span style="${textStyle}">${cleanText}</span>`;
                docStructure.appendChild(taskEl);
            }
            
            // -- C. TAGS --
            else if (fullText.includes('#')) {
                // ... (Keep existing Tag logic) ...
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

        // --- EXECUTE SCANS ---
        if (doc.body && doc.body.content) scanContentList(doc.body.content);

        // Headers/Footers/Footnotes
        if (doc.headers) Object.values(doc.headers).forEach(h => scanContentList(h.content));
        if (doc.footers) Object.values(doc.footers).forEach(f => scanContentList(f.content));
        if (doc.footnotes) Object.values(doc.footnotes).forEach(fn => scanContentList(fn.content));

        // Comments
        if (comments && comments.length > 0) {
            currentSection = { title: 'Comments', id: '' };
            const sep = document.createElement('div');
            sep.innerHTML = '<strong>💬 Comments</strong>';
            sep.style.cssText = "padding:8px 15px; background:#f1f3f4; font-size:11px; color:#5f6368; border-top:1px solid #ddd;";
            docStructure.appendChild(sep);

            comments.forEach(c => {
                 let text = c.content.trim();
                 if (!text) return;
                 
                 // Look for "TODO:" in comments
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

        // --- FINAL UI UPDATES ---
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
        
        if (!document.getElementById('manual-sync-btn') && itemsFound > 0) {
            const btn = document.createElement('button');
            btn.id = 'manual-sync-btn';
            btn.innerText = "📥 Sync to Master Index";
            btn.style.cssText = "margin: 10px; width:calc(100% - 20px); padding:8px; background:#1a73e8; color:white; border:none; border-radius:4px; cursor:pointer;";
            btn.onclick = () => syncCurrentItems();
            docStructure.prepend(btn);
        } else if (itemsFound === 0) {
             docStructure.innerHTML = '<div style="padding:15px; color:#999; font-style:italic; font-size:12px;">No structural data found.<br>Try adding Headings, TODOs, or #tags.</div>';
        }
    }

    async function syncCurrentItems() {
        if (currentScanItems.length === 0 || !currentFileId) return;
        status.innerText = "Syncing to Master Index...";
        try {
           await window.api.syncToSheet({ 
               fileId: currentFileId,
               items: currentScanItems 
           });
           status.innerText = "Synced successfully!";
           alert("Data added to 'Master Index' spreadsheet.");
           loadGlobalTags(); 
        } catch (err) {
           console.error("Sync Error:", err);
           status.innerText = "Sync failed.";
           alert("SYNC FAILED:\n\n" + err.message);
        }
    }

    // =========================================================================
    // 7. DASHBOARD & FILE OPS
    // =========================================================================

    // DASHBOARD
// DASHBOARD
// [renderer.js] - Replace the dashboardBtn logic (Section 7)

    // DASHBOARD
    if (dashboardBtn) {
        dashboardBtn.onclick = async () => {
            dashboardView.style.display = 'flex';
            dashboardTable.innerHTML = '<tr><td colspan="5" style="padding:20px; text-align:center;">Loading tasks...</td></tr>';
            
            // 1. Fetch Data
            const allItems = await window.api.getAllItems();
            
            // 2. Setup Filters UI (Only if not already present)
            let filterContainer = document.getElementById('dash-filter-container');
            if (!filterContainer) {
                const headerSection = dashboardView.querySelector('div'); // The header div
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
                        <option value="RecentlyClosed">Recently Closed</option>
                    </select>
                    <span style="flex:1;"></span>
                    <span id="dash-count" style="font-size:12px; color:#666;"></span>
                `;
                // Insert after header
                headerSection.insertAdjacentElement('afterend', filterContainer);
                
                // Add Event Listeners
                document.getElementById('dash-status-filter').addEventListener('change', renderDashboard);
                document.getElementById('dash-sort-filter').addEventListener('change', renderDashboard);
            }

            // 3. Update Table Header (Remove Type, Add Dates)
            const thead = document.querySelector('#dashboard-view thead tr');
            if (thead) {
                thead.innerHTML = `
                    <th style="padding:8px; width:80px;">Status</th>
                    <th style="padding:8px;">Content</th>
                    <th style="padding:8px; width:140px;">Created</th>
                    <th style="padding:8px; width:140px;">Closed</th>
                    <th style="padding:8px; width:80px;">Action</th>
                `;
            }

            // 4. Render Function
            function renderDashboard() {
                const statusFilter = document.getElementById('dash-status-filter').value;
                const sortFilter = document.getElementById('dash-sort-filter').value;
                
                // A. Filter
                let filtered = allItems.filter(item => {
                    if (statusFilter === 'All') return true;
                    return item.status === statusFilter;
                });

                // B. Sort
                filtered.sort((a, b) => {
                    const dateA = new Date(a.created).getTime();
                    const dateB = new Date(b.created).getTime();
                    const closeA = a.closed ? new Date(a.closed).getTime() : 0;
                    const closeB = b.closed ? new Date(b.closed).getTime() : 0;

                    if (sortFilter === 'Newest') return dateB - dateA;
                    if (sortFilter === 'Oldest') return dateA - dateB;
                    if (sortFilter === 'RecentlyClosed') return closeB - closeA;
                    return 0;
                });

                // C. Render Rows
                dashboardTable.innerHTML = '';
                document.getElementById('dash-count').innerText = `${filtered.length} tasks`;

                if (filtered.length === 0) {
                    dashboardTable.innerHTML = '<tr><td colspan="5" style="padding:20px; text-align:center; color:#999;">No tasks found.</td></tr>';
                    return;
                }

                filtered.forEach(item => {
                    const tr = document.createElement('tr');
                    // COMPACT UI: No border-bottom
                    tr.style.cssText = "background: white;"; 
                    // Zebra striping
                    if (dashboardTable.children.length % 2 === 0) tr.style.background = "#fcfcfc";

                    // Status Badge
                    let statusColor = '#d93025'; // Red (Open)
                    let statusBg = '#fce8e6';
                    if (item.status === 'Closed') { statusColor = '#188038'; statusBg = '#e6f4ea'; }
                    
                    const createdDate = item.created ? item.created.split(',')[0] : '-';
                    const closedDate = item.closed ? item.closed.split(',')[0] : '-';

                    tr.innerHTML = `
                        <td style="padding:4px 8px;">
                            <span style="background:${statusBg}; color:${statusColor}; padding:2px 6px; border-radius:4px; font-size:10px; font-weight:bold; display:inline-block; width:45px; text-align:center;">
                                ${item.status.toUpperCase()}
                            </span>
                        </td>
                        <td style="padding:4px 8px; color:#202124; font-size:13px;">${item.content}</td>
                        <td style="padding:4px 8px; color:#5f6368; font-size:11px;">${createdDate}</td>
                        <td style="padding:4px 8px; color:#5f6368; font-size:11px;">${closedDate}</td>
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

            // Initial Render
            renderDashboard();
        };
    }
    if (closeDashBtn) closeDashBtn.onclick = () => dashboardView.style.display = 'none';

    // DAILY DIARY
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
            } finally {
                dailyBtn.disabled = false;
                dailyBtn.innerHTML = '<span style="margin-right: 6px;">📅</span> Today';
            }
        };
    }

    if (recentHeader && recentList) {
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

    // --- GRAPH VIEW IMPLEMENTATION ---
    if (document.getElementById('toolbar')) {
        const graphBtn = document.createElement('button');
        graphBtn.innerHTML = '🕸️ Graph';
        graphBtn.style.cssText = "width:60px; padding: 8px; background-color: #fff; color: #5f6368; border: 1px solid #dadce0; border-radius: 4px; cursor: pointer; font-size: 13px; margin-left: 5px;";
        document.getElementById('toolbar').appendChild(graphBtn);

        function buildGraphData() {
            const nodes = [];
            const edges = [];
            const processedFiles = new Set();

            Object.keys(globalTagMap).forEach((tag) => {
                nodes.push({ 
                    id: tag, 
                    label: tag, 
                    color: '#34a853', 
                    shape: 'hexagon', 
                    size: 20,
                    font: { color: 'white' }
                });

                globalTagMap[tag].forEach(fileId => {
                    if (!processedFiles.has(fileId)) {
                        nodes.push({ 
                            id: fileId, 
                            label: 'File ' + fileId.substr(0,4),
                            color: '#4285f4',
                            shape: 'dot',
                            size: 10
                        });
                        processedFiles.add(fileId);
                    }
                    edges.push({ from: fileId, to: tag });
                });
            });
            return { nodes, edges };
        }

        graphBtn.onclick = () => {
            if(!graphView) return;
            graphView.style.display = 'block';
            const data = buildGraphData();
            
            const options = {
                nodes: { borderWidth: 2 },
                interaction: { hover: true },
                physics: {
                    stabilization: false,
                    barnesHut: { gravitationalConstant: -3000 }
                }
            };
            
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
            } else {
                networkContainer.innerText = "Graph library not loaded.";
            }
        };
        if(closeGraphBtn) closeGraphBtn.onclick = () => graphView.style.display = 'none';
    }

    function openFile(file, mode = 'preview') {
        if (!file.webViewLink) return;
        
        let targetId = file.id;
        let targetMime = file.mimeType;
        
        if (file.mimeType === 'application/vnd.google-apps.shortcut' && file.shortcutDetails) {
            targetId = file.shortcutDetails.targetId;
            targetMime = file.shortcutDetails.targetMimeType;
        }

        currentFileId = targetId;
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
        
        performScan(targetId, targetMime);
    }

    // =========================================================================
    // 8. FILE TREE LOGIC (With Drag/Drop & Link Creation)
    // =========================================================================

    function createTreeItem(file) {
      const isRealFolder = file.mimeType === 'application/vnd.google-apps.folder';
      const isShortcut = file.mimeType === 'application/vnd.google-apps.shortcut';
      
      // CHECK FOR PSEUDO-LINK (JUMP)
      const isSectionLink = file.appProperties && file.appProperties.role === 'section_link';

      let isFolder = isRealFolder;
      if (isShortcut && file.shortcutDetails?.targetMimeType === 'application/vnd.google-apps.folder') isFolder = true;
      
      const node = document.createElement('div'); node.className = 'tree-node';
      node.dataset.id = file.id; 
      
      const currentParentId = (file.parents && file.parents.length > 0) ? file.parents[0] : 'root';
      node.dataset.parentId = currentParentId;

      const label = document.createElement('div'); label.className = 'tree-label'; 
      label.draggable = true; 
      
      const arrow = document.createElement('span'); arrow.className = 'tree-arrow'; arrow.innerText = isFolder ? '▶' : '';
      
      // ICON LOGIC
      let icon = getIcon(file.mimeType);
      if (isSectionLink) icon = '🔖'; 
      
      label.innerHTML = `<span class="tree-icon">${icon}</span><span>${file.name}</span>`;
      label.prepend(arrow);
      
      const children = document.createElement('div'); children.className = 'tree-children';
      node.appendChild(label); node.appendChild(children);

      // CLICK
      label.onclick = async (e) => {
        e.stopPropagation();
        document.querySelectorAll('.tree-label').forEach(el => el.classList.remove('selected'));
        label.classList.add('selected');
        
        // 1. HANDLE SECTION LINK (The Portal)
        if (isSectionLink) {
            const srcId = file.appProperties.sourceFileId;
            const headId = file.appProperties.headerId;
            status.innerText = `Jumping to section in "${file.name}"...`;
            
            // Construct Deep Link
            const deepLink = `https://docs.google.com/document/d/${srcId}/edit#heading=${headId}`;
            webview.src = deepLink;
            
            // Also trigger a scan of the target so sidebar updates
            performScan(srcId, 'application/vnd.google-apps.document');
            return;
        }

        if (!isFolder) { openFile(file); return; }
        
        // FOLDER LOGIC
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

      // CONTEXT MENU
      label.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        window.api.showContextMenu({ 
            name: file.name, 
            link: file.webViewLink, 
            isFolder: isFolder, 
            id: file.id, 
            parentId: currentParentId, 
            clipboardItem: clipboardItem, 
            shortcutDetails: file.shortcutDetails
        });
      });

      // DRAG START
      label.addEventListener('dragstart', (e) => {
          e.dataTransfer.setData('application/json', JSON.stringify({
              id: file.id,
              name: file.name,
              parentId: currentParentId
          }));
          e.dataTransfer.effectAllowed = 'copyMove';
          label.style.opacity = '0.5';
      });

      label.addEventListener('dragend', () => label.style.opacity = '1');

      // DROP LOGIC
      const canDrop = isFolder;

      if (canDrop) {
          label.addEventListener('dragover', (e) => {
              e.preventDefault(); 
              e.dataTransfer.dropEffect = 'copy'; 
              label.classList.add('drag-over');
          });

          label.addEventListener('dragleave', () => {
              label.classList.remove('drag-over');
          });

          label.addEventListener('drop', async (e) => {
              e.preventDefault();
              e.stopPropagation();
              label.classList.remove('drag-over');

              const rawData = e.dataTransfer.getData('application/json');
              if (!rawData) return;
              const dragData = JSON.parse(rawData);

              // SCENARIO 1: DRAGGING A HEADER -> FOLDER (Create Link)
              if (dragData.type === 'section') {
                  const confirmLink = confirm(`Create a link to section "${dragData.title}" inside "${file.name}"?`);
                  if (!confirmLink) return;

                  status.innerText = `Linking "${dragData.title}"...`;
                  try {
                      await window.api.createSectionLink({
                          parentId: file.id,
                          name: dragData.title, // Name the file after the section
                          sourceFileId: dragData.sourceFileId,
                          headerId: dragData.headerId
                      });
                      
                      status.innerText = "Link created!";
                      refreshFolder(file.id); // Refresh this folder to show the new link
                  } catch (err) {
                      console.error(err);
                      status.innerText = "Creation failed.";
                  }
                  return;
              }

              // SCENARIO 2: FILE -> FOLDER (Move / Standard Drag & Drop)
              if (dragData.id) {
                  if (dragData.id === file.id) return; 
                  if (dragData.parentId === file.id) return; 

                  const confirmMove = confirm(`Move "${dragData.name}" into "${file.name}"?`);
                  if (!confirmMove) return;

                  status.innerText = `Moving "${dragData.name}"...`;
                  try {
                      await window.api.moveFile({ 
                          fileId: dragData.id, 
                          oldParentId: dragData.parentId, 
                          newParentId: file.id 
                      });
                      status.innerText = "Move successful!";
                      await refreshFolder(file.id); // Dest
                      if (dragData.parentId !== file.id) {
                          await refreshFolder(dragData.parentId); // Source
                      }
                  } catch (err) {
                      status.innerText = "Move failed.";
                  }
                  return;
              }
          });
      }

      return node;
    }

    // =========================================================================
    // 9. HELPERS (Refresh, Recents, Icons, Modals)
    // =========================================================================

    // NEW: Helper to refresh a specific folder without collapsing the whole tree
    async function refreshFolder(folderId) {
        if (!folderId || folderId === 'root') { 
            init(); return; 
        }

        const folderNode = document.querySelector(`.tree-node[data-id="${folderId}"]`);
        if (!folderNode) return; 

        const childrenContainer = folderNode.querySelector('.tree-children');
        const arrow = folderNode.querySelector('.tree-arrow');

        const files = await window.api.listFiles(folderId);

        childrenContainer.innerHTML = '';
        if (files.length === 0) {
            childrenContainer.innerHTML = '<div style="padding-left:24px; font-size:12px; color:#999;">(empty)</div>';
        } else {
            files.forEach(f => childrenContainer.appendChild(createTreeItem(f)));
        }

        childrenContainer.style.display = 'block';
        arrow.innerText = '▼';
        arrow.classList.add('rotated');
    }

    function addToRecents(file) {
        let recents = loadRecents().filter(f => f.id !== file.id);
        const pId = (file.parents && file.parents.length > 0) ? file.parents[0] : 'root';
        recents.unshift({ 
            id: file.id, name: file.name, mimeType: file.mimeType, webViewLink: file.webViewLink,
            parentId: pId, shortcutDetails: file.shortcutDetails 
        });
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
                row.className = 'tree-label'; 
                row.style.fontSize = '13px'; 
                row.innerHTML = `<span class="tree-icon">${getIcon(file.mimeType)}</span><span>${file.name}</span>`;
                row.onclick = () => openFile(file);
                row.addEventListener('contextmenu', (e) => {
                    e.preventDefault();
                    let isFolder = file.mimeType === 'application/vnd.google-apps.folder';
                    if (file.mimeType.includes('shortcut') && file.shortcutDetails?.targetMimeType.includes('folder')) isFolder = true;
                    window.api.showContextMenu({ 
                        name: file.name, 
                        link: file.webViewLink, 
                        isFolder: isFolder, 
                        id: file.id, 
                        parentId: file.parentId || 'root', 
                        clipboardItem: clipboardItem,
                        shortcutDetails: file.shortcutDetails
                    });
                });
                recentList.appendChild(row);
            });
            if (!isRecentExpanded) { recentList.style.display = 'none'; recentArrow.style.transform = 'rotate(-90deg)'; }
        } else { if (recentSection) recentSection.style.display = 'none'; }
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

    // Modal Helpers
    function closeModal() { 
        if (modal) modal.style.display = 'none'; 
        pendingCreation = null;
        pendingRename = null; // Reset Rename state
        if (createBtn) createBtn.innerText = "Create"; // Reset Button Text
    }
    if (cancelBtn) cancelBtn.onclick = closeModal;
    if (closeDetailsBtn) closeDetailsBtn.onclick = () => { detailsModal.style.display = 'none'; };

    // Create / Rename File Logic
    if (createBtn) {
        createBtn.onclick = async () => {
            const name = nameInput.value.trim();
            
            // --- RENAME HANDLER ---
            if (pendingRename) {
                if (!name) return;
                status.innerText = "Renaming...";
                try {
                    await window.api.renameFile({ fileId: pendingRename.id, newName: name });
                    status.innerText = "Renamed!";
                    refreshFolder(pendingRename.parentId);
                    closeModal();
                } catch (e) {
                    console.error(e);
                    status.innerText = "Rename failed.";
                }
                return;
            }
            
            // --- CREATE HANDLER ---
            if (!name || !pendingCreation) return; 

            const folderId = pendingCreation.parentId;
            const fileType = pendingCreation.type;
            closeModal();
            
            let mimeType = 'application/vnd.google-apps.folder';
            if (fileType === 'doc') mimeType = 'application/vnd.google-apps.document';
            if (fileType === 'sheet') mimeType = 'application/vnd.google-apps.spreadsheet';
            
            status.innerText = "Creating file...";
            try {
                const newFile = await window.api.createFile({ parentId: folderId, name: name, mimeType: mimeType });
                status.innerText = "Created!";
                refreshFolder(folderId);
            } catch (err) {
                console.error(err);
                status.innerText = "Error creating file.";
            }
        };
    }
    if (nameInput) nameInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') createBtn.click(); });

    // Menu Actions Handler
    if (window.api.onMenuAction) {
        window.api.onMenuAction(async ({ action, data }) => {
            // RENAME ACTION
            if (action === 'rename') {
                pendingRename = data; // { id, name, parentId }
                modalTitle.innerText = "Rename File";
                nameInput.value = data.name;
                createBtn.innerText = "Rename"; // Switch button purpose
                if (modal) { modal.style.display = 'flex'; nameInput.focus(); }
                return;
            }

            // CREATE ACTION
            if (action === 'create') {
                pendingCreation = data; 
                if (modalTitle) modalTitle.innerText = `Name your new ${data.type === 'folder' ? 'Folder' : 'File'}:`;
                if (nameInput) nameInput.value = "";
                if (createBtn) createBtn.innerText = "Create"; // Ensure button says Create
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
                    metaTable.innerHTML = `<tr><td>Type</td><td>${info.metadata.mimeType}</td></tr><tr><td>Size</td><td>${info.metadata.size||'-'}</td></tr>`;
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
            
            // --- CLIPBOARD ACTIONS ---
            if (action === 'copy-ref') { 
                clipboardItem = { ...data, mode: 'shortcut' }; 
                status.innerText = `Copied Link to "${data.name}"`; 
            }
            if (action === 'cut-item') {
                clipboardItem = { ...data, mode: 'move' };
                status.innerText = `Cut "${data.name}" (Ready to paste)`;
            }

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
                        await window.api.moveFile({ 
                            fileId: clipboardItem.id, 
                            oldParentId: oldParent, 
                            newParentId: destId 
                        });
                        status.innerText = "Move successful!";
                        refreshFolder(destId); // Dest
                        if (oldParent !== destId) {
                            refreshFolder(oldParent); // Source
                        }
                        clipboardItem = null; 
                    } catch (e) {
                        status.innerText = "Move failed.";
                        alert("Error moving item.");
                    }
                }
            }
        });
    }

    // =========================================================================
    // 10. INITIALIZATION
    // =========================================================================

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
            loadGlobalTags();
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