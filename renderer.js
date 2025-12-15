document.addEventListener('DOMContentLoaded', () => {
    
    // -- DOM ELEMENTS --
    const fileList = document.getElementById('file-list');
    const recentSection = document.getElementById('recent-section');
    const recentList = document.getElementById('recent-list');
    const status = document.getElementById('status');
    const webview = document.getElementById('doc-view');
    const searchBox = document.getElementById('search-box');
    const searchContentCheck = document.getElementById('search-content-check');
    const dailyBtn = document.getElementById('daily-btn'); 
    
    // COLLAPSIBLE ELEMENTS
    const recentHeader = document.getElementById('recent-header');
    const recentArrow = document.getElementById('recent-arrow');

    // MODAL ELEMENTS
    const modal = document.getElementById('name-modal');
    const modalTitle = document.getElementById('modal-title');
    const nameInput = document.getElementById('filename-input');
    const createBtn = document.getElementById('create-btn');
    const cancelBtn = document.getElementById('cancel-btn');

    // DETAILS & COMMENTS ELEMENTS
    const detailsModal = document.getElementById('details-modal');
    const detailsTitle = document.getElementById('details-title');
    const metaTable = document.getElementById('meta-table-body');
    const versionsList = document.getElementById('versions-list');
    const closeDetailsBtn = document.getElementById('close-details-btn');
    const commentsModal = document.getElementById('comments-modal');
    const commentsTitle = document.getElementById('comments-title');
    const commentsList = document.getElementById('comments-list');
    const closeCommentsBtn = document.getElementById('close-comments-btn');
    
    // METADATA PANE ELEMENTS
    const metaLoading = document.getElementById('meta-loading');
    const metaTags = document.getElementById('meta-tags');
    const metaTasks = document.getElementById('meta-tasks');
    const metaLinks = document.getElementById('meta-links');

    // -- STATE --
    let searchTimeout = null;
    let pendingCreation = null; 
    let isRecentExpanded = true;
    let copiedFile = null; 
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

    // --- DAILY DIARY CLICK HANDLER ---
    if (dailyBtn) {
        dailyBtn.onclick = async () => {
            dailyBtn.disabled = true;
            dailyBtn.innerHTML = '⏳ Opening...';
            status.innerText = "Locating Daily Diary...";
            try {
                const file = await window.api.openDailyDiary();
                if (file) {
                    status.innerText = `Opened Diary: ${file.name}`;
                    // FORCE EDIT MODE HERE 👇
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

    // =========================================================================
    // 0.5 COLLAPSIBLE LOGIC
    // =========================================================================
    if (recentHeader && recentList && recentArrow) {
        recentHeader.onclick = () => {
            isRecentExpanded = !isRecentExpanded;
            recentList.style.display = isRecentExpanded ? 'block' : 'none';
            recentArrow.style.transform = isRecentExpanded ? 'rotate(0deg)' : 'rotate(-90deg)';
        };
    }

    // =========================================================================
    // 1. HELPER FUNCTIONS
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

    function linkify(text) {
        if (!text) return '';
        const urlRegex = /(\b(https?):\/\/[-A-Z0-9+&@#\/%?=~_|!:,.;]*[-A-Z0-9+&@#\/%=~_|])/ig;
        return text.replace(urlRegex, (url) => `<a href="#" onclick="window.api.openExternal('${url}'); return false;" style="color:#1a73e8; text-decoration:underline;">${url}</a>`);
    }

    window.jumpToComment = (fileId, commentId) => {
        const deepLink = `https://docs.google.com/document/d/${fileId}/edit?disco=${commentId}`;
        status.innerText = "Locating comment...";
        webview.src = deepLink;
        if (commentsModal) commentsModal.style.display = 'none';
    };

    function createCommentHTML(comment, fileId) {
        const date = new Date(comment.createdTime).toLocaleString();
        const author = comment.author ? comment.author.displayName : 'Unknown';
        const content = linkify(comment.content); 
        return `
            <div style="margin-bottom: 15px; padding-bottom: 10px; border-bottom: 1px solid #f0f0f0;">
                <div style="font-size: 12px; color: #5f6368; margin-bottom: 4px; display: flex; justify-content: space-between;">
                    <span><strong>${author}</strong> • ${date}</span>
                    <button onclick="window.jumpToComment('${fileId}', '${comment.id}')" style="float: right; border: 1px solid #dadce0; background: #fff; padding: 2px 8px; border-radius: 4px; cursor: pointer; font-size: 11px; color: #1a73e8;">🎯 Locate</button>
                </div>
                <div style="font-size: 14px; color: #202124; white-space: pre-wrap; margin-top: 5px;">${content}</div>
                ${comment.replies && comment.replies.length > 0 ? `<div style="margin-left: 15px; margin-top: 8px; border-left: 2px solid #ddd; padding-left: 10px;">${comment.replies.map(reply => createCommentHTML(reply, fileId)).join('')}</div>` : ''}
            </div>
        `;
    }

    // =========================================================================
    // 2. OPEN FILE LOGIC (UPDATED FOR MODES)
    // =========================================================================
    function openFile(file, mode = 'preview') {
        if (!file.webViewLink) return;
        status.innerText = `Loading: ${file.name}...`;
        let link = file.webViewLink;
        
        if (mode === 'edit') {
            // FORCE EDIT MODE
            link = link.replace(/\/view.*$/, '/edit').replace(/\/preview.*$/, '/edit');
        } else {
            // FORCE PREVIEW MODE (Default)
            link = link.replace(/\/edit.*$/, '/preview').replace(/\/view.*$/, '/preview');
        }

        webview.src = link;
        addToRecents(file); 
        scanCommentsForMetadata(file.id);
    }

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

    async function scanCommentsForMetadata(fileId) {
        if(!metaLoading) return;
        metaLoading.style.display = 'block';
        metaTags.innerHTML = '<span style="color:#ccc; font-size:12px;">Scanning...</span>';
        metaTasks.innerHTML = ''; metaLinks.innerHTML = '';
        try {
            const comments = await window.api.getFileComments(fileId);
            const tags = [], tasks = [], links = [];
            const scanList = (list) => {
                list.forEach(c => {
                    const lines = c.content.split('\n');
                    lines.forEach(line => {
                        const text = line.trim();
                        if (!text) return;
                        const tagMatches = text.match(/(^|\s)(#[a-zA-Z0-9-_]+)(?=$|[\s.,!?])/g);
                        if (tagMatches) tagMatches.forEach(t => tags.push({ text: t.trim(), commentId: c.id }));
                        const taskRegex = /^(todo:|\[\s*\]|-\s*\[\s*\])/i;
                        if (taskRegex.test(text)) {
                            tasks.push({ text: text.replace(taskRegex, '').trim(), commentId: c.id, author: c.author.displayName });
                        }
                        if (text.includes('http')) {
                            const urlMatches = text.match(/(https?:\/\/[^\s]+)/g);
                            if (urlMatches) urlMatches.forEach(u => links.push({ url: u, commentId: c.id }));
                        }
                    });
                    if (c.replies) scanList(c.replies);
                });
            };
            scanList(comments);

            // Render
            if (tags.length > 0) {
                const uniqueTags = [...new Set(tags.map(t => t.text))];
                metaTags.innerHTML = '';
                uniqueTags.forEach(tagText => {
                    const tagEl = document.createElement('span');
                    tagEl.innerText = tagText;
                    tagEl.style.cssText = "background:#e8f0fe; color:#1967d2; padding:2px 8px; border-radius:12px; font-size:11px; cursor:pointer; border:1px solid #d2e3fc;";
                    tagEl.onclick = () => { if (searchBox) { searchBox.value = tagText; if (searchContentCheck) searchContentCheck.checked = true; searchBox.dispatchEvent(new Event('input')); } };
                    metaTags.appendChild(tagEl);
                });
            } else { metaTags.innerHTML = '<span style="color:#999; font-size:12px; font-style:italic;">No #tags found</span>'; }

            if (tasks.length > 0) {
                metaTasks.innerHTML = '';
                tasks.forEach(t => {
                    const row = document.createElement('div');
                    row.style.cssText = "display:flex; margin-bottom:8px; font-size:12px; color:#333; cursor:pointer; align-items:flex-start; padding: 2px 0;";
                    row.innerHTML = `<span style="margin-right:6px; color:#5f6368; font-size:14px;">☐</span><span style="line-height:1.4;">${t.text}</span>`;
                    row.onclick = () => window.jumpToComment(fileId, t.commentId);
                    row.onmouseover = () => { row.style.color = '#1a73e8'; row.style.background = '#f1f3f4'; };
                    row.onmouseout = () => { row.style.color = '#333'; row.style.background = 'transparent'; };
                    metaTasks.appendChild(row);
                });
            } else { metaTasks.innerHTML = '<div style="color:#999; font-size:12px; font-style:italic;">No tasks found</div>'; }

            if (links.length > 0) {
                metaLinks.innerHTML = '';
                links.forEach(l => {
                    const row = document.createElement('div');
                    row.style.cssText = "margin-bottom:6px; font-size:12px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;";
                    row.innerHTML = `<a href="#" onclick="window.api.openExternal('${l.url}'); return false;" style="color:#1a73e8; text-decoration:none;">🔗 ${l.url}</a>`;
                    metaLinks.appendChild(row);
                });
            } else { metaLinks.innerHTML = '<div style="color:#999; font-size:12px; font-style:italic;">No links found</div>'; }
        } catch (e) { console.error("Meta scan failed", e); } finally { metaLoading.style.display = 'none'; }
    }

    // =========================================================================
    // 3. MENU ACTIONS
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
            if (action === 'comments') {
                if (!commentsModal) return;
                commentsTitle.innerText = `Comments: ${data.name}`;
                commentsList.innerHTML = 'Loading...';
                commentsModal.style.display = 'flex';
                try {
                    const comments = await window.api.getFileComments(data.id);
                    commentsList.innerHTML = comments.length ? comments.map(c => createCommentHTML(c, data.id)).join('') : 'No comments.';
                } catch (err) { commentsList.innerText = "Error."; }
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
    if (closeCommentsBtn) closeCommentsBtn.onclick = () => { commentsModal.style.display = 'none'; };

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
    // 4. SEARCH & TREE VIEW
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