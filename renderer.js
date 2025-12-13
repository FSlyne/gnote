// renderer.js

document.addEventListener('DOMContentLoaded', () => {
    
    const fileList = document.getElementById('file-list');
    const status = document.getElementById('status');
    const webview = document.getElementById('doc-view');
  
    // Icon Helper
    function getIcon(mimeType) {
      if (mimeType === 'application/vnd.google-apps.folder') return '📁';
      if (mimeType.includes('spreadsheet')) return '📊';
      if (mimeType.includes('document')) return '📝';
      if (mimeType.includes('presentation')) return '📑';
      if (mimeType.includes('pdf')) return '📕';
      if (mimeType.includes('image')) return '🖼️';
      return '📄';
    }
  
    // ---------------------------------------------------------
    // Function: Create a Single Tree Node
    // ---------------------------------------------------------
    function createTreeItem(file) {
      const isFolder = file.mimeType === 'application/vnd.google-apps.folder';
  
      // 1. Container
      const nodeContainer = document.createElement('div');
      nodeContainer.className = 'tree-node';
  
      // 2. Label Row
      const labelRow = document.createElement('div');
      labelRow.className = 'tree-label';
      
      // Arrow
      const arrow = document.createElement('span');
      arrow.className = 'tree-arrow';
      // Only show arrow if it is a folder
      arrow.innerText = isFolder ? '▶' : ''; 
      
      // Icon
      const icon = document.createElement('span');
      icon.className = 'tree-icon';
      icon.innerText = getIcon(file.mimeType);
  
      // Text
      const text = document.createElement('span');
      text.innerText = file.name;
  
      labelRow.appendChild(arrow);
      labelRow.appendChild(icon);
      labelRow.appendChild(text);
  
      // 3. Children Container
      const childrenContainer = document.createElement('div');
      childrenContainer.className = 'tree-children';
  
      // -------------------------------------------------------
      // CLICK LOGIC
      // -------------------------------------------------------
      labelRow.onclick = async (e) => {
        e.stopPropagation();
  
        // Visual Selection
        document.querySelectorAll('.tree-label').forEach(el => el.classList.remove('selected'));
        labelRow.classList.add('selected');
  
        // CASE A: It's a File -> Open in WebView
        if (!isFolder && file.webViewLink) {
            status.innerText = `Loading: ${file.name}...`;
            
            // Try to use 'preview' mode for cleaner embedding
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
  
        // CASE B: It's a Folder -> Toggle
        if (isFolder) {
            const isExpanded = childrenContainer.style.display === 'block';
  
            if (isExpanded) {
                // Collapse
                childrenContainer.style.display = 'none';
                arrow.innerText = '▶';
                arrow.classList.remove('rotated');
            } else {
                // Expand
                childrenContainer.style.display = 'block';
                arrow.innerText = '▼';
                arrow.classList.add('rotated');
  
                // LAZY LOAD: If empty, fetch from API
                if (childrenContainer.children.length === 0) {
                    const originalIcon = icon.innerText;
                    icon.innerText = '⏳'; // Loading state
                    
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
                            children.forEach(child => {
                                childrenContainer.appendChild(createTreeItem(child));
                            });
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
  
      nodeContainer.appendChild(labelRow);
      nodeContainer.appendChild(childrenContainer);
      return nodeContainer;
    }
  
    // ---------------------------------------------------------
    // Initial Load
    // ---------------------------------------------------------
    async function init() {
      try {
        status.innerText = 'Waiting for Google sign-in...';
        
        // Fetch Root ('root')
        const rootFiles = await window.api.listFiles('root');
        
        status.innerText = `Loaded ${rootFiles.length} items from Root.`;
        fileList.innerHTML = '';
        
        if (rootFiles.length === 0) {
            fileList.innerText = "No files found in root.";
        }
  
        rootFiles.forEach(file => {
            fileList.appendChild(createTreeItem(file));
        });
      } catch (e) {
        console.error(e);
        status.innerText = 'Error initializing app.';
        fileList.innerHTML = `<div style="padding:10px; color:red;">
          <strong>Error:</strong> ${e.message}
        </div>`;
      }
    }
  
    // Start
    init();
  });