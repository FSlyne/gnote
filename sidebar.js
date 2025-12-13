import React, { useState, useEffect } from 'react';

// NOTE: Ensure 'gapi' is initialized in your main App.js before this component loads.
// If you use a library like 'react-google-drive-picker' or similar, adapt the client call below.

const Sidebar = ({ onFolderSelect }) => {
  const [folders, setFolders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    // Load the root folders as soon as the component mounts
    fetchRootFolders();
  }, []);

  /**
   * Fetches only folders from the root directory.
   */
  const fetchRootFolders = async () => {
    try {
      setLoading(true);
      
      // 1. The Query: Search for folders inside 'root' that are not in the trash
      const query = "'root' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false";

      // 2. The API Call
      // Ensure gapi.client.drive is available
      const response = await window.gapi.client.drive.files.list({
        q: query,
        fields: 'files(id, name, iconLink)', // Only get what we need for the UI
        orderBy: 'name',
        pageSize: 100
      });

      const folderList = response.result.files;
      
      if (folderList && folderList.length > 0) {
        setFolders(folderList);
      } else {
        setFolders([]); // No folders found
      }
      
    } catch (err) {
      console.error("Error fetching sidebar folders:", err);
      setError("Failed to load folders");
    } finally {
      setLoading(false);
    }
  };

  // --- Render Logic ---

  return (
    <div style={styles.sidebarContainer}>
      <h3 style={styles.header}>My Drive</h3>

      {/* Loading State */}
      {loading && <div style={styles.status}>Loading folders...</div>}

      {/* Error State */}
      {error && <div style={styles.error}>{error}</div>}

      {/* Empty State */}
      {!loading && !error && folders.length === 0 && (
        <div style={styles.status}>No folders found in Root.</div>
      )}

      {/* Folder List */}
      <ul style={styles.list}>
        {folders.map((folder) => (
          <li 
            key={folder.id} 
            style={styles.listItem}
            onClick={() => onFolderSelect(folder.id)} // Pass ID back to parent to update the main view
          >
            <span style={styles.icon}>📁</span>
            {folder.name}
          </li>
        ))}
      </ul>
    </div>
  );
};

// --- Basic Styles (You can replace this with CSS classes) ---
const styles = {
  sidebarContainer: {
    width: '250px',
    height: '100%',
    borderRight: '1px solid #e0e0e0',
    padding: '20px',
    backgroundColor: '#f8f9fa',
    overflowY: 'auto'
  },
  header: {
    fontSize: '16px',
    fontWeight: '600',
    color: '#3c4043',
    marginBottom: '15px'
  },
  list: {
    listStyleType: 'none',
    padding: 0,
    margin: 0
  },
  listItem: {
    display: 'flex',
    alignItems: 'center',
    padding: '8px 12px',
    borderRadius: '0 20px 20px 0',
    cursor: 'pointer',
    color: '#3c4043',
    fontSize: '14px',
    marginBottom: '4px'
  },
  icon: {
    marginRight: '10px'
  },
  status: {
    fontSize: '13px',
    color: '#5f6368',
    fontStyle: 'italic'
  },
  error: {
    fontSize: '13px',
    color: '#d93025'
  }
};

export default Sidebar;