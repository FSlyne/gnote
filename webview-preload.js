// webview-preload.js
const { ipcRenderer } = require('electron');

document.addEventListener('contextmenu', (e) => {
    // Check if the clicked element (or its parent) is a Header
    const header = e.target.closest('h1, h2, h3, h4, h5, h6');
    
    if (header && header.id) {
        // Stop the standard browser menu from appearing
        e.preventDefault();

        // Get the clean URL (remove existing # anchors)
        const baseUrl = window.location.href.split('#')[0];
        const deepLink = `${baseUrl}#${header.id}`;

        // Send this specific link back to the main app
        ipcRenderer.sendToHost('header-context-menu', {
            url: deepLink,
            text: header.innerText.substring(0, 30) // First 30 chars of title
        });
    }
});