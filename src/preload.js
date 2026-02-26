const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    sendNotificationClick: () => ipcRenderer.send('notification-click'),
    updateUnreadCount: (count) => ipcRenderer.send('unread-count', count)
});

// Proxy Notification API to capture clicks
const OldNotification = window.Notification;
function NewNotification(title, options) {
    const notification = new OldNotification(title, options);
    notification.addEventListener('click', () => {
        ipcRenderer.send('notification-click');
    });
    return notification;
}
NewNotification.prototype = OldNotification.prototype;
NewNotification.permission = OldNotification.permission;
NewNotification.requestPermission = OldNotification.requestPermission;
window.Notification = NewNotification;

function updateUnreadCount() {
    const title = document.title;
    const match = title.match(/\((\d+)\)/);
    const count = match ? parseInt(match[1]) : 0;
    ipcRenderer.send('unread-count', count);
}

window.addEventListener('load', () => {
    // Inject Privacy Styles
    const style = document.createElement('style');
    style.id = 'privacy-styles';
    style.innerHTML = `
        body.privacy-blur #app, body.privacy-blur [role="main"] {
            filter: blur(15px);
            transition: filter 0.3s ease;
        }
    `;
    document.head.appendChild(style);

    const titleTag = document.querySelector('title');
    if (titleTag) {
        const observer = new MutationObserver(() => {
            updateUnreadCount();
        });
        observer.observe(titleTag, { childList: true });
    }
    updateUnreadCount();
});

// Theme Sync
ipcRenderer.on('update-theme', (event, isDarkMode) => {
    if (isDarkMode) {
        document.body.classList.add('dark');
        document.body.classList.remove('light');
    } else {
        document.body.classList.add('light');
        document.body.classList.remove('dark');
    }
});

// Privacy Blur
ipcRenderer.on('toggle-privacy', (event, enable) => {
    if (enable) {
        document.body.classList.add('privacy-blur');
    } else {
        document.body.classList.remove('privacy-blur');
    }
});

// Connection Status
function updateConnectionStatus() {
    ipcRenderer.send('connection-status', navigator.onLine);
}
window.addEventListener('online', updateConnectionStatus);
window.addEventListener('offline', updateConnectionStatus);
updateConnectionStatus();
