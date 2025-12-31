# Send to GNote - Chrome Integration

You can easily send any web page from Chrome (or Edge/Firefox) to GNote using a customized **Bookmarklet**.

## 1. Create the Bookmark
1.  Make sure your **Bookmarks Bar** is visible in Chrome (`Ctrl+Shift+B`).
2.  Right-click on the bar and select **"Add page..."**.
3.  **Name:** `Send to GNote`
4.  **URL:** Copy and paste the code below exactly:

```javascript
javascript:(function(){window.location='gnote://new?url='+encodeURIComponent(location.href)+'&title='+encodeURIComponent(document.title);})();
```

## 2. How to Use
1.  **Restart GNote** (You must restart for the new "Protocol Handler" to register with Windows).
    *   *Note: On the very first run after restart, Windows might ask you "How do you want to open this?" or "Allow this site to open the gnote link?" - Select "Always allow".*
2.  Browse to any website in Chrome.
3.  Click your **"Send to GNote"** bookmark.
4.  GNote will pop to the front, and the **New Web Link** modal will appear with the Name and URL pre-filled!
5.  Add tags/notes and click **Create Link**.

## Troubleshooting
*   **"Application not found"**: If nothing happens or you get an error, ensure you fully restarted GNote (`Ctrl+C` in terminal, then `npm start`). Electron registers the `gnote://` protocol on startup.
*   **Dev Mode**: Since you are running in Development Mode (`npm start`), the protocol might trigger a new Electron instance or behave slightly differently than a built `.exe`. The code we added handles "Second Instance" logic to ensure it sends the link to your running app instead of crashing.
