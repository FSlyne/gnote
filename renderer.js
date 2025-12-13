document.addEventListener('DOMContentLoaded', () => {
    
    // -- DOM ELEMENTS --
    const fileList = document.getElementById('file-list');
    const recentSection = document.getElementById('recent-section');
    const recentList = document.getElementById('recent-list');
    const status = document.getElementById('status');
    const webview = document.getElementById('doc-view');
    const searchBox = document.getElementById('search-box');
    
    // Create Modal Elements
    const modal = document.getElementById('name-modal');
    const modalTitle = document.getElementById('modal-title');
    const nameInput = document.getElementById('filename-input');
    const createBtn = document.getElementById('create-btn');
    const cancelBtn = document.getElementById('cancel-btn');

    // Details Modal Elements
    const detailsModal = document.getElementById('details-modal');
    const detailsTitle = document.getElementById('details-title');
    const metaTable = document.getElementById('meta-table-body');
    const versionsList = document.getElementById('versions-list');
    const closeDetailsBtn = document.getElementById('close-details-btn');

    // -- STATE --
    let searchTimeout = null;
    let pendingCreation = null; 
    const MAX_RECENT = 10;

    // =========================================================================
    // 1. RECENT FILES SYSTEM
    // =========================================================================
    function loadRecents() {
        const data = localStorage.getItem('recentFiles');
        return data ? JSON.parse(data) : [];
    }

    function saveRecents(files) {
        localStorage.setItem('recentFiles', JSON.stringify(files));
        renderRecents();
    }

    function addToRecents(file) {
        let recents = loadRecents();
        recents = recents.filter(f => f.id !== file.id);
        recents.unshift({
            id: file.id,
            name: file.name,
            mimeType: file.mimeType,
            webViewLink: file.webViewLink
        });
        if (recents.length > MAX_RECENT) recents = recents.slice(0, MAX_RECENT);
        saveRecents(recents);
    }

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
                
                const icon = document.createElement('span');
                icon.className = 'tree-icon';
                icon.innerText = getIcon(file.mimeType);
                
                const text = document.createElement('span');
                text.innerText = file.name;
                text.style.whiteSpace = 'nowrap';
                text.style.overflow = 'hidden';
                text.style.textOverflow = 'ellipsis';

                row.appendChild(icon);
                row.appendChild(text);

                row.onclick = () => openFile(file);
                recentList.appendChild(row);
            });
        } else {
            if (recentSection) recentSection.style.display = 'none';
        }
    }

    // =========================================================================
    // 2. FILE OPENING & PREVIEW
    // =========================================================================
    function openFile(file) {
        if (!file.webViewLink) return;

        status.innerText = `Loading: ${file.name}...`;
        let link = file.webViewLink;
        
        if (link.includes('/view') || link.includes('/edit')) {
             link = link.replace(/\/edit.*$/, '/preview').replace(/\/view.*$/, '/preview');
        }
        
        webview.src = link;
        addToRecents(file); 

        webview.addEventListener('did-finish-load', () => {
            status.innerText = `Viewing: ${file.name}`;
        }, { once: true });
    }

    // =========================================================================
    // 3. MENU ACTIONS (CREATE & DETAILS)
    // =========================================================================
    
    // Listen for Menu Actions from Main Process
    if (window.api.onMenuAction) {
        window.api.onMenuAction(async ({ action, data }) => {
            
            // --- ACTION: CREATE NEW ---
            if (action === 'create') {
                pendingCreation = data;
                
                let typeName = "File";
                if (data.type === 'folder') typeName = "Folder";
                if (data.type === 'doc') typeName = "Google Doc";
                if (data.type === 'sheet') typeName = "Google Sheet";
                
                if (modalTitle) modalTitle.innerText = `Name your new ${typeName}:`;
                if (nameInput) nameInput.value = "";
                if (modal) {
                    modal.style.display = 'flex';
                    nameInput.focus();
                }
            }

            // --- ACTION: VIEW DETAILS ---
            if (action === 'details') {
                if (!detailsModal) return;
                
                detailsTitle.innerText = `Loading: ${data.name}...`;
                detailsModal.style.display = 'flex';
                metaTable.innerHTML = '';
                versionsList.innerHTML = 'Fetching versions...';

                try {
                    const info = await window.api.getFileDetails(data.id);
                    const meta = info.metadata;
                    
                    detailsTitle.innerText = meta.name;

                    // Build Metadata Table
                    const rows = [
                        ['Type', meta.mimeType],
                        ['Size', formatSize(meta.size)],
                        ['Created', formatDate(meta.createdTime)],
                        ['Modified', formatDate(meta.modifiedTime)],
                        ['Owner', meta.owners ? meta.owners.map(o => o.displayName).join(', ') : 'Me']
                    ];

                    metaTable.innerHTML = rows.map(r => `
                        <tr style="border-bottom: 1px solid #f0f0f0;">
                            <td style="padding: 8px 0; font-weight: bold; width: 100px; color:#5f6368;">${r[0]}</td>
                            <td style="padding: 8px 0;">${r[1]}</td>
                        </tr>
                    `).join('');

                    // Build Versions List
                    if (info.revisions && info.revisions.length > 0) {
                        versionsList.innerHTML = info.revisions.map(rev => `
                            <div style="padding: 8px; border-bottom: 1px solid #f0f0f0; display: flex; justify-content: space-between;">
                                <span>
                                    <strong>${formatDate(rev.modifiedTime)}</strong> 
                                    <span style="color:#666;"> - ${rev.lastModifyingUser?.displayName || 'Unknown'}</span>
                                </span>
                                <span style="font-family: monospace; background: #eee; padding: 2px 4px; border-radius: 3px;">
                                    ID: ${rev.id.substring(0,6)}...
                                </span>
                            </div>
                        `).join('');
                    } else {
                        versionsList.innerHTML = '<div style="padding:10px; color:#999;">No version history available.</div>';
                    }

                } catch (err) {
                    console.error(err);
                    versionsList.innerText = "Error loading details.";
                }
            }
        });
    }

    // --- MODAL HANDLERS ---
    
    function closeModal() {
        if (modal) modal.style.display = 'none';
        pendingCreation = null;
    }

    if (cancelBtn) cancelBtn.onclick = closeModal;
    if (closeDetailsBtn) closeDetailsBtn.onclick = () => { detailsModal.style.display = 'none'; };

    if (createBtn) {
        createBtn.onclick = async () => {
            const name = nameInput.value.trim();
            
            // 1. Safety Check & Capture Data
            if (!name || !pendingCreation) return;
            const parentId = pendingCreation.parentId;
            const type = pendingCreation.type;

            let mimeType = 'application/vnd.google-apps.folder';
            if (type === 'doc') mimeType = 'application/vnd.google-apps.document';
            if (type === 'sheet') mimeType = 'application/vnd.google-apps.spreadsheet';

            status.innerText = `Creating "${name}"...`;
            
            // 2. Close Modal
            closeModal();

            try {
                // 3. Create File
                await window.api.createFile({
                    parentId: parentId,
                    name: name,
                    mimeType: mimeType
                });
                
                status.innerText = `Created ${name}. Refreshing folder...`;

                // 4. AUTO-REFRESH LOGIC
                // Find parent folder and reload its children
                const parentNode = document.querySelector(`.tree-node[data-id="${parentId}"]`);
                
                if (parentNode) {
                    const childrenContainer = parentNode.querySelector('.tree-children');
                    const arrow = parentNode.querySelector('.tree-arrow');

                    if (childrenContainer) {
                        childrenContainer.style.display = 'block'; 
                        if (arrow) {
                            arrow.innerText = '▼';
                            arrow.classList.add('rotated');
                        }
                        
                        childrenContainer.innerHTML = ''; 
                        const children = await window.api.listFiles(parentId);
                        
                        if (children.length === 0) {
                            childrenContainer.innerHTML = '<div style="padding-left:24px; font-size:12px; color:#999;">(empty)</div>';
                        } else {
                            children.forEach(child => childrenContainer.appendChild(createTreeItem(child)));
                        }
                        status.innerText = 'Ready';
                    }
                } else {
                    alert(`Created "${name}".`);
                    init(); // Reload whole tree if parent not found
                }
                
            } catch (err) {
                console.error(err);
                status.innerText = "Error creating file.";
                alert("Failed to create file.");
            }
        };
    }

    if (nameInput) {
        nameInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') createBtn.click();
        });
    }

    // -- FORMAT HELPERS --
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


    // =========================================================================
    // 4. LISTENERS (IPC & SEARCH)
    // =========================================================================

    if (window.api.onAuthSuccess) {
        window.api.onAuthSuccess(() => {
            console.log("Auth success signal received!");
            status.innerText = "Login confirmed. Loading files...";
            init(); 
        });
    }

    webview.addEventListener('ipc-message', (event) => {
        if (event.channel === 'header-context-menu') {
            window.api.showHeaderMenu(event.args[0]);
        }
    });

    if (searchBox) {
        searchBox.addEventListener('input', (e) => {
            const query = e.target.value.trim();
            if (searchTimeout) clearTimeout(searchTimeout);

            if (query.length === 0) {
                init(); 
                return;
            }

            searchTimeout = setTimeout(async () => {
                status.innerText = `Searching for "${query}"...`;
                fileList.innerHTML = ''; 
                try {
                    const results = await window.api.searchFiles(query);
                    if (results.length === 0) {
                        fileList.innerHTML = '<div style="padding:15px; color:#666;">No results found.</div>';
                        status.innerText = 'No results.';
                    } else {
                        status.innerText = `Found ${results.length} results.`;
                        results.forEach(file => fileList.appendChild(createTreeItem(file)));
                    }
                } catch (err) {
                    console.error(err);
                    status.innerText = "Search failed.";
                }
            }, 500);
        });
    }

    // =========================================================================
    // 5. TREE VIEW HELPERS & DRAG-DROP
    // =========================================================================
    function getIcon(mimeType) {
      if (mimeType === 'application/vnd.google-apps.folder') return '📁';
      if (mimeType.includes('spreadsheet')) return '📊';
      if (mimeType.includes('document')) return '📝';
      if (mimeType.includes('presentation')) return '📑';
      if (mimeType.includes('pdf')) return '📕';
      if (mimeType.includes('image')) return '🖼️';
      return '📄';
    }
  
    function createTreeItem(file) {
      const isFolder = file.mimeType === 'application/vnd.google-apps.folder';
      const nodeContainer = document.createElement('div');
      
      nodeContainer.className = 'tree-node';
      nodeContainer.dataset.id = file.id; 
      
      // Store current parent for drag logic
      const currentParentId = (file.parents && file.parents.length > 0) ? file.parents[0] : 'root';
      nodeContainer.dataset.parentId = currentParentId;
  
      const labelRow = document.createElement('div');
      labelRow.className = 'tree-label';
      labelRow.draggable = true; // Enable Drag
      
      const arrow = document.createElement('span');
      arrow.className = 'tree-arrow';
      arrow.innerText = isFolder ? '▶' : ''; 
      
      const icon = document.createElement('span');
      icon.className = 'tree-icon';
      icon.innerText = getIcon(file.mimeType);
  
      const text = document.createElement('span');
      text.innerText = file.name;
  
      labelRow.appendChild(arrow);
      labelRow.appendChild(icon);
      labelRow.appendChild(text);
  
      const childrenContainer = document.createElement('div');
      childrenContainer.className = 'tree-children';
  
      // --- CLICK HANDLER ---
      labelRow.onclick = async (e) => {
        e.stopPropagation();
        document.querySelectorAll('.tree-label').forEach(el => el.classList.remove('selected'));
        labelRow.classList.add('selected');
  
        if (!isFolder) {
            openFile(file);
            return;
        }
  
        if (isFolder) {
            const isExpanded = childrenContainer.style.display === 'block';
            if (isExpanded) {
                childrenContainer.style.display = 'none';
                arrow.innerText = '▶';
                arrow.classList.remove('rotated');
            } else {
                childrenContainer.style.display = 'block';
                arrow.innerText = '▼';
                arrow.classList.add('rotated');
                if (childrenContainer.children.length === 0) {
                    const originalIcon = icon.innerText;
                    icon.innerText = '⏳';
                    try {
                        status.innerText = `Fetching contents of ${file.name}...`;
                        const children = await window.api.listFiles(file.id);
                        if (children.length === 0) {
                            childrenContainer.innerHTML = '<div style="padding-left:24px; font-size:12px; color:#999;">(empty)</div>';
                        } else {
                            children.forEach(child => childrenContainer.appendChild(createTreeItem(child)));
                        }
                        status.innerText = 'Ready';
                    } catch (err) {
                        console.error(err);
                        status.innerText = "Error loading folder";
                    } finally {
                        icon.innerText = originalIcon;
                    }
                }
            }
        }
      };

      // --- CONTEXT MENU (RIGHT CLICK) ---
      labelRow.addEventListener('contextmenu', (e) => {
        e.preventDefault(); 
        document.querySelectorAll('.tree-label').forEach(el => el.classList.remove('selected'));
        labelRow.classList.add('selected');
        
        window.api.showContextMenu({
            name: file.name,
            link: file.webViewLink,
            isFolder: isFolder,
            id: file.id 
        });
      });

      // --- DRAG AND DROP HANDLERS ---
      
      // 1. Drag Start
      labelRow.addEventListener('dragstart', (e) => {
          e.stopPropagation();
          const data = JSON.stringify({ id: file.id, oldParent: currentParentId, name: file.name });
          e.dataTransfer.setData('application/json', data);
          e.dataTransfer.effectAllowed = 'move';
          labelRow.style.opacity = '0.5';
      });

      // 2. Drag End
      labelRow.addEventListener('dragend', () => {
          labelRow.style.opacity = '1';
      });

      // 3. Drop (Only on Folders)
      if (isFolder) {
          labelRow.addEventListener('dragover', (e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
              labelRow.style.backgroundColor = '#d2e3fc';
          });

          labelRow.addEventListener('dragleave', () => {
              labelRow.style.backgroundColor = '';
              if (labelRow.classList.contains('selected')) labelRow.style.backgroundColor = '#e8f0fe';
          });

          labelRow.addEventListener('drop', async (e) => {
              e.preventDefault();
              e.stopPropagation();
              labelRow.style.backgroundColor = '';

              const rawData = e.dataTransfer.getData('application/json');
              if (!rawData) return;
              
              const draggedItem = JSON.parse(rawData);
              
              if (draggedItem.id === file.id) return;
              if (draggedItem.oldParent === file.id) return;

              const confirmMove = confirm(`Move "${draggedItem.name}" into "${file.name}"?`);
              if (!confirmMove) return;

              status.innerText = `Moving "${draggedItem.name}"...`;

              try {
                  await window.api.moveFile({
                      fileId: draggedItem.id,
                      oldParentId: draggedItem.oldParent,
                      newParentId: file.id
                  });

                  status.innerText = `Moved! Refreshing...`;
                  
                  // UI Refresh: Remove old node
                  const oldNode = document.querySelector(`.tree-node[data-id="${draggedItem.id}"]`);
                  if (oldNode) oldNode.remove();
                  
                  // Reload new parent folder
                  childrenContainer.innerHTML = ''; 
                  childrenContainer.style.display = 'none'; 
                  labelRow.click(); // Trigger click to expand/reload

              } catch (err) {
                  console.error(err);
                  status.innerText = "Error moving file.";
                  alert("Failed to move file.");
              }
          });
      }
  
      nodeContainer.appendChild(labelRow);
      nodeContainer.appendChild(childrenContainer);
      return nodeContainer;
    }
  
    // =========================================================================
    // 6. INITIALIZATION
    // =========================================================================
    async function init() {
      const oldBtn = document.getElementById('login-btn');
      if (oldBtn) oldBtn.remove();
      
      renderRecents();

      try {
        status.innerText = 'Checking connection...';
        const rootFiles = await window.api.listFiles('root');
        
        if (rootFiles.length > 0) {
            status.innerText = `Loaded ${rootFiles.length} items.`;
            fileList.innerHTML = '';
            rootFiles.forEach(file => fileList.appendChild(createTreeItem(file)));
        } else {
            status.innerText = 'Not signed in (or drive is empty).';
            fileList.innerHTML = '';
            
            const btn = document.createElement('button');
            btn.id = 'login-btn';
            btn.innerText = "🔑 Sign In with Google";
            btn.style.width = "100%";
            btn.style.padding = "10px";
            btn.style.marginTop = "10px";
            btn.style.backgroundColor = "#4285F4";
            btn.style.color = "white";
            btn.style.border = "none";
            btn.style.borderRadius = "4px";
            btn.style.cursor = "pointer";
            btn.style.fontSize = "14px";
            
            btn.onclick = async () => {
                status.innerText = "Opening browser...";
                btn.disabled = true;
                btn.innerText = "Waiting for browser...";
                await window.api.openWebLogin();
            };
            fileList.appendChild(btn);
        }
      } catch (e) {
        console.error(e);
        status.innerText = 'Error initializing app.';
        
        fileList.innerHTML = `<div style="padding:10px; color:red; font-size:12px;">Connection failed. Please try signing in again.</div>`;
        const btn = document.createElement('button');
        btn.innerText = "Retry Sign In";
        btn.style.marginTop = "10px";
        btn.onclick = () => window.api.openWebLogin();
        fileList.appendChild(btn);
      }
    }
  
    init();
});