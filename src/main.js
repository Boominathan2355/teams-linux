const { app, BrowserWindow, shell, session, Tray, Menu, ipcMain, nativeTheme, globalShortcut } = require('electron');
const fs = require('fs');
const path = require('path');
const contextMenu = require('electron-context-menu');
const Store = require('electron-store');

// Initialize store
const store = new (Store.default || Store)();

// Disable hardware acceleration to prevent GPU process crashes on some Linux environments
if (store.get('hardwareAcceleration') === false) {
    app.disableHardwareAcceleration();
}

// Enable WebRTC PipeWire Capturer for Linux
app.commandLine.appendSwitch('enable-features', 'WebRTCPipeWireCapturer');
app.commandLine.appendSwitch('enable-usermedia-screen-capturing');
app.commandLine.appendSwitch('allow-http-screen-capture');
app.commandLine.appendSwitch('disable-site-isolation-trials');

// Workaround for GTK font-antialiasing segmentation fault on Linux
app.commandLine.appendSwitch('disable-font-subpixel-positioning');
app.commandLine.appendSwitch('ozone-platform-hint', 'auto');

let mainWindow;
let isQuitting = false;
let tray = null;
let currentUnreadCount = 0;
let isOnline = true;

const teamsUrl = 'https://teams.microsoft.com/';

const offlineContent = `
<!DOCTYPE html>
<html>
<head>
    <title>Offline - Microsoft Teams</title>
    <style>
        body {
            background-color: #464775;
            color: white;
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            height: 100vh;
            margin: 0;
            overflow: hidden;
        }
        .container { text-align: center; }
        .icon { font-size: 64px; margin-bottom: 20px; }
        h1 { font-size: 24px; margin-bottom: 10px; }
        p { font-size: 16px; opacity: 0.8; }
        .spinner {
            border: 4px solid rgba(255,255,255,0.1);
            border-left: 4px solid #fff;
            border-radius: 50%;
            width: 30px;
            height: 30px;
            animation: spin 1s linear infinite;
            margin: 20px auto;
        }
        .btn {
            background-color: #6264a7;
            color: white;
            border: none;
            padding: 10px 20px;
            font-size: 14px;
            border-radius: 4px;
            cursor: pointer;
            margin-top: 20px;
            transition: background-color 0.2s;
        }
        .btn:hover { background-color: #464775; border: 1px solid #fff; }
        @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
    </style>
</head>
<body>
    <div class="container">
        <div class="icon">🔌</div>
        <h1>Connection Lost</h1>
        <p>We're having trouble reaching Microsoft Teams.</p>
        <div class="spinner"></div>
        <p>Automatically reconnecting when internet is back...</p>
        <button class="btn" onclick="window.electronAPI.reconnect()">Retry Now</button>
    </div>
</body>
</html>
`;

// Default Settings
const defaultSettings = {
    privacyMode: false,
    minimizeToTray: true,
    startHidden: false,
    autoStart: true,
    alwaysOnTop: false,
    spellcheck: true,
    hardwareAcceleration: false,
    isMuted: false,
    zoomFactor: 1.0,
    confirmExit: false
};

// Initialize settings if they don't exist
Object.entries(defaultSettings).forEach(([key, value]) => {
    if (store.get(key) === undefined) {
        store.set(key, value);
    }
});

function updateAutoStart() {
    if (process.platform === 'linux') {
        app.setLoginItemSettings({
            openAtLogin: store.get('autoStart'),
            path: process.execPath,
            args: ['--hidden']
        });
    }
}
updateAutoStart();

function createWindow() {
    // Load saved window state
    const windowState = store.get('windowState', {
        width: 1200,
        height: 800,
        x: undefined,
        y: undefined
    });

    mainWindow = new BrowserWindow({
        width: windowState.width,
        height: windowState.height,
        x: windowState.x,
        y: windowState.y,
        backgroundColor: '#464775', // Teams purple background
        title: 'Microsoft Teams',
        icon: path.join(__dirname, 'assets', 'icon.png'),
        show: !process.argv.includes('--hidden') && !store.get('startHidden'),
        alwaysOnTop: store.get('alwaysOnTop'),
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js'),
            spellcheck: store.get('spellcheck')
        }
    });

    if (store.get('isMuted')) {
        mainWindow.webContents.setAudioMuted(true);
    }

    // Initialize context menu
    contextMenu({
        window: mainWindow,
        showSaveImageAs: true,
        showCopyImageAddress: true,
        showInspectElement: false // Disable in production
    });

    // Save window state
    const saveState = () => {
        if (!mainWindow.isNormal()) return;
        const bounds = mainWindow.getBounds();
        store.set('windowState', {
            width: bounds.width,
            height: bounds.height,
            x: bounds.x,
            y: bounds.y
        });
    };
    mainWindow.on('resize', saveState);
    mainWindow.on('move', saveState);

    // Privacy Mode - Blur on focus loss
    mainWindow.on('blur', () => {
        if (store.get('privacyMode', false)) {
            mainWindow.webContents.send('toggle-privacy', true);
        }
    });
    mainWindow.on('focus', () => {
        if (store.get('privacyMode', false)) {
            mainWindow.webContents.send('toggle-privacy', false);
        }
    });

    // Dark Mode Sync
    const updateTheme = () => {
        const isDarkMode = nativeTheme.shouldUseDarkColors;
        mainWindow.webContents.send('update-theme', isDarkMode);
    };
    nativeTheme.on('updated', updateTheme);

    // Load MS Teams
    const userAgent = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
    app.userAgentFallback = userAgent;

    mainWindow.loadURL(teamsUrl, { userAgent });

    // Force context menu to use the correct window
    contextMenu({
        window: mainWindow,
        showSaveImageAs: true,
        showCopyImageAddress: true,
        showInspectElement: true
    });

    // Custom CSS Injection and Zoom
    const userCssPath = path.join(app.getPath('userData'), 'user.css');
    mainWindow.webContents.on('did-finish-load', () => {
        console.log('MS Teams loaded successfully');
        updateTheme();

        // Restore Zoom Level
        const zoom = store.get('zoomFactor', 1.0);
        mainWindow.webContents.setZoomFactor(zoom);

        if (fs.existsSync(userCssPath)) {
            const css = fs.readFileSync(userCssPath, 'utf8');
            mainWindow.webContents.insertCSS(css);
        }
    });

    // Suppress noisy replychains console warnings from Teams web app
    mainWindow.webContents.on('console-message', (event) => {
        if (event.message.includes('getSerializedKeyForKeypath returned undefined key in InMemoryIndex for table: replychains')) {
            event.preventDefault();
        }
    });

    // Navigation Shortcuts
    mainWindow.webContents.on('before-input-event', (event, input) => {
        if (input.type === 'keyDown' && input.alt) {
            if (input.key === 'ArrowLeft' && mainWindow.webContents.canGoBack()) {
                mainWindow.webContents.goBack();
                event.preventDefault();
            } else if (input.key === 'ArrowRight' && mainWindow.webContents.canGoForward()) {
                mainWindow.webContents.goForward();
                event.preventDefault();
            }
        }
        // Zoom Shortcuts
        if (input.type === 'keyDown' && input.control) {
            let zoom = mainWindow.webContents.getZoomFactor();
            if (input.key === '=') { // Plus key
                zoom = Math.min(zoom + 0.1, 2.0);
                mainWindow.webContents.setZoomFactor(zoom);
                store.set('zoomFactor', zoom);
                event.preventDefault();
            } else if (input.key === '-') {
                zoom = Math.max(zoom - 0.1, 0.5);
                mainWindow.webContents.setZoomFactor(zoom);
                store.set('zoomFactor', zoom);
                event.preventDefault();
            } else if (input.key === '0') {
                mainWindow.webContents.setZoomFactor(1.0);
                store.set('zoomFactor', 1.0);
                event.preventDefault();
            }
        }
        // DevTools and Reload Shortcuts
        if (input.type === 'keyDown') {
            if (input.control && input.shift && input.key === 'I') {
                mainWindow.webContents.toggleDevTools();
                event.preventDefault();
            } else if ((input.control && input.key === 'r') || input.key === 'F5') {
                if (input.shift) {
                    mainWindow.webContents.reloadIgnoringCache();
                } else {
                    mainWindow.webContents.reload();
                }
                event.preventDefault();
            }
        }
    });

    mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL, isMainFrame) => {
        console.error('Failed to load:', validatedURL, errorDescription, '(Main Frame:', isMainFrame, ')');

        // Don't show offline page for aborted loads (e.g. manual reload) or subframe failures
        if (errorCode === -3 || !isMainFrame) return;

        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(offlineContent)}`);
        }

        const networkErrors = [-102, -105, -106, -118, -137];
        if (networkErrors.includes(errorCode)) {
            setTimeout(() => {
                if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.getURL().includes('teams.microsoft.com')) {
                    mainWindow.loadURL(teamsUrl);
                }
            }, 5000);
        }
    });

    // Handle external links security
    const allowedHostnames = [
        'microsoft.com', 'microsoftonline.com', 'live.com', 'office.com',
        'office.net', 'office365.com', 'skype.com', 'skypeassets.com',
        'sharepoint.com', 'sharepointonline.com', 'msteams.com', 'msftauth.net',
        'msauth.net', 'teams.microsoft.com'
    ];

    const isUrlAllowed = (url) => {
        try {
            const parsedUrl = new URL(url);
            return allowedHostnames.some(hn => parsedUrl.hostname === hn || parsedUrl.hostname.endsWith('.' + hn));
        } catch (e) {
            return false;
        }
    };

    mainWindow.webContents.on('will-navigate', (event, url) => {
        if (url === teamsUrl || url.startsWith('data:')) return;
        if (!isUrlAllowed(url)) {
            event.preventDefault();
            shell.openExternal(url);
        }
    });

    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        if (isUrlAllowed(url)) return { action: 'allow' };
        shell.openExternal(url);
        return { action: 'deny' };
    });

    // Content Security Policy
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
        const responseHeaders = Object.assign({}, details.responseHeaders);
        Object.keys(responseHeaders).forEach(key => {
            if (key.toLowerCase() === 'content-security-policy') delete responseHeaders[key];
        });
        callback({
            responseHeaders: {
                ...responseHeaders,
                'Content-Security-Policy': [
                    "default-src 'self' https://*.microsoft.com https://*.microsoftonline.com https://*.live.com https://*.office.com https://*.office.net https://*.office365.com https://*.skype.com https://*.skypeassets.com https://*.msftauth.net https://*.msauth.net https://*.sharepoint.com https://*.sharepointonline.com https://*.msteams.com blob: data: filesystem:; " +
                    "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://*.microsoft.com https://*.microsoftonline.com https://*.office.com https://*.office.net https://*.msftauth.net https://*.msauth.net https://*.sharepoint.com https://*.msteams.com blob: data:; " +
                    "worker-src 'self' blob: data: https://*.microsoft.com https://*.office.com https://*.office.net https://*.msftauth.net https://*.msauth.net https://*.sharepoint.com https://*.msteams.com; " +
                    "style-src 'self' 'unsafe-inline' https://*.microsoft.com https://*.office.com https://*.office.net https://*.msftauth.net https://*.msauth.net https://*.sharepoint.com https://*.msteams.com; " +
                    "img-src 'self' https://*.microsoft.com https://*.microsoftonline.com https://*.office.com https://*.office.net https://*.office365.com https://*.skype.com https://*.skypeassets.com https://*.msftauth.net https://*.msauth.net https://*.sharepoint.com https://*.msteams.com data: blob:; " +
                    "connect-src 'self' https://*.microsoft.com https://*.microsoftonline.com https://*.office.com https://*.office.net https://*.office365.com https://*.skype.com https://*.msftauth.net https://*.msauth.net https://*.sharepoint.com https://*.msteams.com wss://*.microsoft.com wss://*.skype.com; " +
                    "font-src 'self' data: https://*.microsoft.com https://*.office.com https://*.office.net https://*.msftauth.net https://*.msauth.net https://*.sharepoint.com https://*.msteams.com; " +
                    "media-src 'self' blob: https://*.microsoft.com https://*.office.com https://*.office.net https://*.skype.com https://*.sharepoint.com https://*.msteams.com;"
                ]
            }
        });
    });

    // Permissions
    session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
        const allowed = ['media', 'display-capture', 'notifications', 'fullscreen', 'pointerLock'];
        callback(allowed.includes(permission));
    });

    // Download Management
    session.defaultSession.on('will-download', (event, item, webContents) => {
        const fileName = item.getFilename();
        mainWindow.webContents.send('notification', {
            title: 'Download Started',
            body: `Downloading ${fileName}...`
        });

        item.once('done', (event, state) => {
            if (state === 'completed') {
                mainWindow.webContents.send('notification', {
                    title: 'Download Complete',
                    body: `${fileName} has been downloaded.`
                });
            } else {
                mainWindow.webContents.send('notification', {
                    title: 'Download Failed',
                    body: `Failed to download ${fileName}.`
                });
            }
        });
    });

    mainWindow.on('close', (event) => {
        if (!isQuitting && store.get('minimizeToTray')) {
            event.preventDefault();
            mainWindow.hide();
        }
    });

    createMenu();
}

function createMenu() {
    const template = [
        {
            label: 'File',
            submenu: [
                {
                    label: 'Privacy Mode',
                    type: 'checkbox',
                    checked: store.get('privacyMode'),
                    click: (item) => {
                        store.set('privacyMode', item.checked);
                        if (!mainWindow.isFocused()) {
                            mainWindow.webContents.send('toggle-privacy', item.checked);
                        }
                    }
                },
                {
                    label: 'Reconnect',
                    accelerator: 'CmdOrCtrl+R',
                    click: () => {
                        if (mainWindow && !mainWindow.isDestroyed()) {
                            mainWindow.loadURL(teamsUrl);
                        }
                    }
                },
                { type: 'separator' },
                {
                    label: 'Always on Top',
                    type: 'checkbox',
                    checked: store.get('alwaysOnTop'),
                    click: (item) => {
                        store.set('alwaysOnTop', item.checked);
                        mainWindow.setAlwaysOnTop(item.checked);
                    }
                },
                {
                    label: 'Confirm on Exit',
                    type: 'checkbox',
                    checked: store.get('confirmExit'),
                    click: (item) => store.set('confirmExit', item.checked)
                },
                { type: 'separator' },
                {
                    label: 'Mute App',
                    type: 'checkbox',
                    checked: store.get('isMuted'),
                    click: (item) => {
                        store.set('isMuted', item.checked);
                        mainWindow.webContents.setAudioMuted(item.checked);
                    }
                },
                { type: 'separator' },
                {
                    label: 'Open Custom CSS',
                    click: () => {
                        const userCssPath = path.join(app.getPath('userData'), 'user.css');
                        if (!fs.existsSync(userCssPath)) {
                            fs.writeFileSync(userCssPath, '/* Add your custom Teams CSS here */\n', 'utf8');
                        }
                        shell.openPath(userCssPath);
                    }
                },
                { type: 'separator' },
                {
                    label: 'Settings',
                    submenu: [
                        {
                            label: 'Minimize to Tray on Close',
                            type: 'checkbox',
                            checked: store.get('minimizeToTray'),
                            click: (item) => store.set('minimizeToTray', item.checked)
                        },
                        {
                            label: 'Confirm on Exit',
                            type: 'checkbox',
                            checked: store.get('confirmExit'),
                            click: (item) => store.set('confirmExit', item.checked)
                        },
                        {
                            label: 'Start Hidden',
                            type: 'checkbox',
                            checked: store.get('startHidden'),
                            click: (item) => store.set('startHidden', item.checked)
                        },
                        {
                            label: 'Auto-start on Login',
                            type: 'checkbox',
                            checked: store.get('autoStart'),
                            click: (item) => {
                                store.set('autoStart', item.checked);
                                updateAutoStart();
                            }
                        },
                        { type: 'separator' },
                        {
                            label: 'Enable Spellcheck',
                            type: 'checkbox',
                            checked: store.get('spellcheck'),
                            click: (item) => {
                                store.set('spellcheck', item.checked);
                                const { dialog } = require('electron');
                                dialog.showMessageBox(mainWindow, {
                                    type: 'info',
                                    message: 'Spellcheck setting updated. Please restart the app for changes to take effect.',
                                    buttons: ['OK']
                                });
                            }
                        },
                        {
                            label: 'Enable Hardware Acceleration',
                            type: 'checkbox',
                            checked: store.get('hardwareAcceleration'),
                            click: (item) => {
                                store.set('hardwareAcceleration', item.checked);
                                const { dialog } = require('electron');
                                dialog.showMessageBox(mainWindow, {
                                    type: 'info',
                                    message: 'Hardware Acceleration updated. App restart required.',
                                    buttons: ['OK']
                                });
                            }
                        }
                    ]
                },
                { type: 'separator' },
                {
                    label: 'Reset All Settings',
                    click: async () => {
                        const { dialog } = require('electron');
                        const result = await dialog.showMessageBox(mainWindow, {
                            type: 'warning',
                            title: 'Reset Settings',
                            message: 'Are you sure you want to reset all settings to default and restart?',
                            buttons: ['Cancel', 'Reset and Restart'],
                            defaultId: 1
                        });

                        if (result.response === 1) {
                            store.clear();
                            app.relaunch();
                            app.exit();
                        }
                    }
                },
                { type: 'separator' },
                {
                    label: 'Clear Cache and Restart',
                    click: async () => {
                        const { dialog } = require('electron');
                        const result = await dialog.showMessageBox(mainWindow, {
                            type: 'warning',
                            title: 'Clear Cache',
                            message: 'Are you sure you want to clear the application cache and restart?',
                            buttons: ['Cancel', 'Clear and Restart'],
                            defaultId: 1
                        });

                        if (result.response === 1) {
                            await session.defaultSession.clearCache();
                            await session.defaultSession.clearStorageData();
                            app.relaunch();
                            app.exit();
                        }
                    }
                },
                { type: 'separator' },
                { label: 'Close to Tray', accelerator: 'CmdOrCtrl+W', click: () => mainWindow.hide() },
                { type: 'separator' },
                { role: 'quit' }
            ]
        },
        { role: 'editMenu' },
        {
            label: 'View',
            submenu: [
                { role: 'reload' },
                { role: 'forceReload' },
                { role: 'toggleDevTools' },
                { type: 'separator' },
                { role: 'resetZoom' },
                { role: 'zoomIn' },
                { role: 'zoomOut' },
                { type: 'separator' },
                { role: 'togglefullscreen' }
            ]
        },
        {
            label: 'Help',
            submenu: [
                {
                    label: 'About MS Teams Linux',
                    click: () => {
                        const { dialog } = require('electron');
                        dialog.showMessageBox(mainWindow, {
                            title: 'About MS Teams Linux',
                            message: 'MS Teams Linux Wrapper',
                            detail: 'A lightweight Linux wrapper for Microsoft Teams.\nVersion: 1.1.0',
                            buttons: ['OK'],
                            icon: path.join(__dirname, 'assets', 'icon.png')
                        });
                    }
                },
                {
                    label: 'Check for Updates',
                    click: () => shell.openExternal('https://github.com/Boominathan2355/teams-linux')
                },
                {
                    label: 'Open GPU Diagnostics',
                    click: () => {
                        const gpuWin = new BrowserWindow({ width: 800, height: 600, title: 'GPU Diagnostics' });
                        gpuWin.loadURL('chrome://gpu');
                    }
                },
                { type: 'separator' },
                {
                    label: 'Open Application Data Folder',
                    click: () => shell.openPath(app.getPath('userData'))
                }
            ]
        }
    ];
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function updateTrayIcon() {
    if (!tray) return;
    let iconName = 'icon.png';
    if (!isOnline) {
        iconName = 'icon-offline.png';
    } else if (currentUnreadCount > 0) {
        iconName = 'icon-unread.png';
    }
    const iconPath = path.join(__dirname, 'assets', iconName);
    tray.setImage(iconPath);
    const tooltip = isOnline ? (currentUnreadCount > 0 ? `Teams (${currentUnreadCount} unread)` : 'Teams') : 'Teams (Offline)';
    tray.setToolTip(tooltip);
}

function createTray() {
    tray = new Tray(path.join(__dirname, 'assets', 'icon.png'));
    const updateTrayMenu = () => {
        tray.setContextMenu(Menu.buildFromTemplate([
            { label: 'Show App', click: () => mainWindow.show() },
            {
                label: 'Always on Top',
                type: 'checkbox',
                checked: store.get('alwaysOnTop'),
                click: (item) => {
                    store.set('alwaysOnTop', item.checked);
                    mainWindow.setAlwaysOnTop(item.checked);
                }
            },
            { type: 'separator' },
            { label: 'Quit', click: () => { isQuitting = true; app.quit(); } }
        ]));
    };

    tray.on('click', () => {
        mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show();
        updateTrayMenu();
    });

    updateTrayMenu();
    updateTrayIcon();
}

// Auto-start on login logic moved to updateAutoStart() and called at startup

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
    app.quit();
} else {
    app.on('second-instance', () => {
        if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.show();
            mainWindow.focus();
        }
    });

    app.whenReady().then(() => {
        createWindow();
        createTray();

        globalShortcut.register('Alt+Shift+T', () => {
            if (mainWindow) {
                mainWindow.isVisible() && mainWindow.isFocused() ? mainWindow.hide() : (mainWindow.show(), mainWindow.focus());
            }
        });

        ipcMain.on('unread-count', (event, count) => {
            currentUnreadCount = count;
            if (app.setBadgeCount) app.setBadgeCount(count);
            updateTrayIcon();
        });

        ipcMain.on('connection-status', (event, online) => {
            const wasOffline = !isOnline;
            isOnline = online;
            updateTrayIcon();

            if (online && wasOffline) {
                console.log('Back online, reloading Teams...');
                if (mainWindow && !mainWindow.isDestroyed()) {
                    const currentUrl = mainWindow.webContents.getURL();
                    if (!currentUrl.includes('teams.microsoft.com')) {
                        mainWindow.loadURL(teamsUrl);
                    }
                }
            } else if (!online) {
                console.log('App went offline');
                if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
                    mainWindow.webContents.send('notification', {
                        title: 'Teams Offline',
                        body: 'Connection lost. We will reconnect automatically.'
                    });
                }
            }
        });

        ipcMain.on('notification-click', () => {
            if (mainWindow) {
                if (mainWindow.isMinimized()) mainWindow.restore();
                mainWindow.show();
                mainWindow.focus();
            }
        });

        ipcMain.on('reconnect-request', () => {
            console.log('Manual reconnect requested');
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.loadURL(teamsUrl);
            }
        });
    });
}

app.on('before-quit', (event) => {
    if (isQuitting) return;

    if (store.get('confirmExit')) {
        const { dialog } = require('electron');
        const result = dialog.showMessageBoxSync(mainWindow, {
            type: 'question',
            buttons: ['Cancel', 'Quit'],
            defaultId: 1,
            title: 'Confirm Exit',
            message: 'Are you sure you want to quit Microsoft Teams?'
        });

        if (result === 0) {
            event.preventDefault();
        } else {
            isQuitting = true;
        }
    } else {
        isQuitting = true;
    }
});
app.on('window-all-closed', () => process.platform !== 'darwin' && app.quit());
