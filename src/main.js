const { app, BrowserWindow, shell, session, Tray, Menu, ipcMain, nativeTheme, globalShortcut } = require('electron');
const fs = require('fs');
const path = require('path');
const contextMenu = require('electron-context-menu');
const Store = require('electron-store');

// Initialize store
const store = new (Store.default || Store)();

// Initialize context menu
contextMenu({
    showSaveImageAs: true,
    showCopyImageAddress: true,
    showInspectElement: false // Disable in production
});

// Disable hardware acceleration to prevent GPU process crashes on some Linux environments
app.disableHardwareAcceleration();

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
        show: !process.argv.includes('--hidden'),
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js'),
            spellcheck: true
        }
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
    const teamsUrl = 'https://teams.microsoft.com/';
    const userAgent = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
    app.userAgentFallback = userAgent;

    mainWindow.loadURL(teamsUrl, { userAgent });

    // Custom CSS Injection
    const userCssPath = path.join(app.getPath('userData'), 'user.css');
    mainWindow.webContents.on('did-finish-load', () => {
        console.log('MS Teams loaded successfully');
        updateTheme();
        if (fs.existsSync(userCssPath)) {
            const css = fs.readFileSync(userCssPath, 'utf8');
            mainWindow.webContents.insertCSS(css);
        }
    });

    mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
        console.error('Failed to load:', validatedURL, errorDescription);
        const networkErrors = [-102, -105, -106, -118, -137];
        if (networkErrors.includes(errorCode)) {
            setTimeout(() => {
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.loadURL(teamsUrl, { userAgent });
                }
            }, 5000);
        }
    });

    // Handle external links security
    mainWindow.webContents.on('will-navigate', (event, url) => {
        const parsedUrl = new URL(url);
        const allowedHostnames = ['microsoft.com', 'microsoftonline.com', 'live.com', 'office.com'];
        const isAllowed = allowedHostnames.some(hn => parsedUrl.hostname === hn || parsedUrl.hostname.endsWith('.' + hn));
        if (!isAllowed) {
            event.preventDefault();
            shell.openExternal(url);
        }
    });

    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        const parsedUrl = new URL(url);
        const allowedHostnames = ['microsoft.com', 'microsoftonline.com', 'live.com', 'office.com'];
        const isAllowed = allowedHostnames.some(hn => parsedUrl.hostname === hn || parsedUrl.hostname.endsWith('.' + hn));
        if (isAllowed) return { action: 'allow' };
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
                    "default-src 'self' https://*.microsoft.com https://*.microsoftonline.com https://*.live.com https://*.office.com https://*.office.net https://*.office365.com https://*.skype.com https://*.skypeassets.com https://*.msftauth.net https://*.msauth.net blob: data: filesystem:; " +
                    "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://*.microsoft.com https://*.microsoftonline.com https://*.office.com https://*.office.net https://*.msftauth.net https://*.msauth.net blob: data:; " +
                    "worker-src 'self' blob: data: https://*.microsoft.com https://*.office.com https://*.office.net https://*.msftauth.net https://*.msauth.net; " +
                    "style-src 'self' 'unsafe-inline' https://*.microsoft.com https://*.office.com https://*.office.net https://*.msftauth.net https://*.msauth.net; " +
                    "img-src 'self' https://*.microsoft.com https://*.microsoftonline.com https://*.office.com https://*.office.net https://*.office365.com https://*.skype.com https://*.skypeassets.com https://*.msftauth.net https://*.msauth.net data: blob:; " +
                    "connect-src 'self' https://*.microsoft.com https://*.microsoftonline.com https://*.office.com https://*.office.net https://*.office365.com https://*.skype.com https://*.msftauth.net https://*.msauth.net wss://*.microsoft.com wss://*.skype.com; " +
                    "font-src 'self' data: https://*.microsoft.com https://*.office.com https://*.office.net https://*.msftauth.net https://*.msauth.net; " +
                    "media-src 'self' blob: https://*.microsoft.com https://*.office.com https://*.office.net https://*.skype.com;"
                ]
            }
        });
    });

    // Permissions
    session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
        const allowed = ['media', 'display-capture', 'notifications', 'fullscreen', 'pointerLock'];
        callback(allowed.includes(permission));
    });

    mainWindow.on('close', (event) => {
        if (!isQuitting) {
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
                    checked: store.get('privacyMode', false),
                    click: (item) => {
                        store.set('privacyMode', item.checked);
                        if (!mainWindow.isFocused()) {
                            mainWindow.webContents.send('toggle-privacy', item.checked);
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
        { role: 'viewMenu' },
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
                            detail: 'A lightweight Linux wrapper for Microsoft Teams.\nVersion: 1.0.0',
                            buttons: ['OK'],
                            icon: path.join(__dirname, 'assets', 'icon.png')
                        });
                    }
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
    tray.setContextMenu(Menu.buildFromTemplate([
        { label: 'Show App', click: () => mainWindow.show() },
        { type: 'separator' },
        { label: 'Quit', click: () => { isQuitting = true; app.quit(); } }
    ]));
    tray.on('click', () => {
        mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show();
    });
    updateTrayIcon();
}

// Auto-start on login
if (process.platform === 'linux') {
    app.setLoginItemSettings({
        openAtLogin: true,
        path: process.execPath,
        args: ['--hidden']
    });
}

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
            isOnline = online;
            updateTrayIcon();
        });

        ipcMain.on('notification-click', () => {
            if (mainWindow) {
                if (mainWindow.isMinimized()) mainWindow.restore();
                mainWindow.show();
                mainWindow.focus();
            }
        });
    });
}

app.on('before-quit', () => isQuitting = true);
app.on('window-all-closed', () => process.platform !== 'darwin' && app.quit());
