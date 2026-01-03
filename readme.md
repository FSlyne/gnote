# GNote: Unified Knowledge Management System

## Background
GNote is a desktop productivity application that transforms Google Drive from a simple cloud storage service into a Unified Knowledge Management System. Built on Electron, it provides a seamless three-pane interface where users can view documents, manage files via drag-and-drop, and utilize "Pseudo-Files"—smart shortcuts that treat external links (like Dropbox or Trello) and specific document sections as native files within your folder tree. This allows for a completely unified project workspace where all resources, regardless of their origin, live side-by-side.

Beyond organization, GNote adds a layer of intelligence to your data. Its real-time Content Scanner automatically parses open documents to extract headings, tasks, hashtags, and metadata, visualizing connections in a Graph View or syncing them to a "Master Index" Google Sheet. By bridging the gap between a file explorer and a second-brain tool, GNote turns static Google Docs into a dynamic, interconnected database without ever leaving the Google ecosystem.

## Getting Started

### Prerequisites
Before running the application, ensure you have the following installed:
*   [Node.js](https://nodejs.org/) (v16.0.0 or higher)
*   [npm](https://www.npmjs.com/) (usually included with Node.js)

You also need a Google Cloud Project with the following APIs enabled:
*   **Google Drive API**
*   **Google Docs API**
*   **Google Sheets API**

### Installation

1.  Clone the repository:
    ```bash
    git clone https://github.com/FSlyne/gnote.git
    cd gnote
    ```

2.  Install dependencies:
    ```bash
    npm install
    ```

### Configuration

1.  **Credentials**: Go to the [Google Cloud Console](https://console.cloud.google.com/).
2.  Create an OAuth Client ID (Application Type: Desktop App).
3.  Download the JSON file and save it as `credentials.json` in the root directory of the project.
    > **Note:** Without `credentials.json`, the application will not be able to authenticate with Google.

### Running the Application

To start the application in development mode:

```bash
npm start
```

### First Run Authentication
1.  When you run the app for the first time, your default browser will open asking for permission to access your Google Drive.
2.  Grant the permissions.
3.  Once authenticated, a `token.json` file will be generated in the root directory. This token stores your session so you don't need to log in every time.

## Documentation
*   [Technical Specification](./docs/specification.md): Detailed breakdown of features, architecture, and data flow.
*   [Implementation Plan](./docs/implementation_plan.md): Current development plan and status.
