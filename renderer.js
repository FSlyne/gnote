// renderer.js
document.addEventListener('DOMContentLoaded', () => {
    
    const fileList = document.getElementById('file-list');
    const status = document.getElementById('status');
    const webview = document.getElementById('doc-view');

    // 1. LISTEN FOR HEADER CONTEXT MENU (Deep Linking)
    webview.addEventListener('ipc-message', (event) => {
        if (event.channel === 'header-context-menu') {
            window.api.showHeaderMenu(event.args[0]);
        }
    });
  
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
  
      const labelRow = document.createElement('div');
      labelRow.className = 'tree-label';
      
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
  
      // LEFT CLICK: Preview or Expand
      labelRow.onclick = async (e) => {
        e.stopPropagation();
  
        document.querySelectorAll('.tree-label').forEach(el => el.classList.remove('selected'));
        labelRow.classList.add('selected');
  
        // 1. File -> Preview
        if (!isFolder && file.webViewLink) {
            status.innerText = `Loading: ${file.name}...`;
            let link = file.webViewLink;
            if (link.includes('/view') || link.includes('/edit')) {
                 link = link.replace(/\/edit.*$/, '/preview').replace(/\/view.*$/, '/preview');
            }
            webview.src = link;
            webview.addEventListener('did-finish-load', () => {
                status.innerText = `Viewing: ${file.name}`;
            }, { once: true });
            return;
        }
  
        // 2. Folder -> Expand/Collapse
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
                            const emptyMsg = document.createElement('div');
                            emptyMsg.innerText = '(empty)';
                            emptyMsg.style.paddingLeft = '24px';
                            emptyMsg.style.fontSize = '12px';
                            emptyMsg.style.color = '#999';
                            childrenContainer.appendChild(emptyMsg);
                        } else {
                            children.forEach(child => childrenContainer.appendChild(createTreeItem(child)));
                        }
                        status.innerText = 'Ready';
                    } catch (err) {
                        console.error(err);
                        status.innerText = "Error loading folder";
                        icon.innerText = '⚠️';
                    } finally {
                        icon.innerText = originalIcon;
                    }
                }
            }
        }
      };

      // UPDATED: RIGHT CLICK (Context Menu) - Works on Files AND Folders
      labelRow.addEventListener('contextmenu', (e) => {
        e.preventDefault(); 
        
        // Select it visually
        document.querySelectorAll('.tree-label').forEach(el => el.classList.remove('selected'));
        labelRow.classList.add('selected');

        // Send data to Main process
        window.api.showContextMenu({
            name: file.name,
            link: file.webViewLink,
            isFolder: isFolder // Pass this so main.js knows what text to show
        });
      });
  
      nodeContainer.appendChild(labelRow);
      nodeContainer.appendChild(childrenContainer);
      return nodeContainer;
    }
  
    async function init() {
      try {
        status.innerText = 'Waiting for Google sign-in...';
        const rootFiles = await window.api.listFiles('root');
        status.innerText = `Loaded ${rootFiles.length} items from Root.`;
        fileList.innerHTML = '';
        if (rootFiles.length === 0) fileList.innerText = "No files found in root.";
        rootFiles.forEach(file => fileList.appendChild(createTreeItem(file)));
      } catch (e) {
        console.error(e);
        status.innerText = 'Error initializing app.';
        fileList.innerHTML = `<div style="padding:10px; color:red;"><strong>Error:</strong> ${e.message}</div>`;
      }
    }
  
    init();
  });