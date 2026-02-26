# Microsoft Teams Linux Wrapper

A lightweight, native-feeling Microsoft Teams wrapper for Linux built with Electron. This wrapper enhances the web experience with deep desktop integration and power-user utilities.

## Features

### 🚀 Desktop Integration
- **Native System Tray**: Minimize to tray, quick access menu, and unread message indicators.
- **Window State Persistence**: Automatically restores your last window size and position.
- **Single Instance Lock**: Prevents multiple instances of the app from running.
- **Auto-start on Login**: Toggleable setting to launch Teams when you log in.
- **Always on Top**: Keep the Teams window above all others (toggle from menu or tray).

### 🛠️ Expert Controls
- **Privacy Mode**: Automatically blurs the application window when it loses focus.
- **Mute App**: Quickly silence all notifications and call audio.
- **Spellcheck Toggle**: Enable or disable spellcheck support (restart required).
- **Hardware Acceleration**: Toggle HW acceleration for troubleshooting GPU issues (restart required).
- **GPU Diagnostics**: Direct access to `chrome://gpu` for rendering diagnostics.
- **Developer Tools**: Standard access to Electron DevTools (`Ctrl+Shift+I`).

### 🎨 Customization & Utilities
- **Custom CSS Support**: Add your own styles via the `user.css` file.
- **Zoom Persistence**: Your zoom level is saved and restored automatically.
- **Clear Cache**: Utility to wipe session data and restart.
- **Data Folder Access**: Quick link to open the application data directory.

### 🌐 Resilience
- **Smart Reconnection**: Custom offline page with a "Retry Now" button and automatic reconnection.
- **Download Notifications**: Native OS notifications for file download start and completion.

## Installation

### Prerequisites
- Node.js (v20 or higher)
- npm

### Development
1. Clone the repository:
   ```bash
   git clone https://github.com/boominathan2355/teams-linux.git
   cd teams-linux
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Start the application:
   ```bash
   npm start
   ```

### Building Packages
To build the AppImage and .deb packages:
```bash
npm run dist
```

## Docker Support

You can build and run the application using Docker (requires X11 forwarding).

1. Build the image:
   ```bash
   docker build -t teams-linux .
   ```
2. Run the container:
   ```bash
   xhost +local:docker
   docker run -it --rm \
     -e DISPLAY=$DISPLAY \
     -v /tmp/.X11-unix:/tmp/.X11-unix \
     teams-linux
   ```

## Shortcuts
- `Alt+Shift+T`: Toggle Visibility
- `Alt+Left/Right`: Navigation (Back/Forward)
- `Ctrl+Plus/Minus/0`: Zoom Control
- `Ctrl+Shift+I`: Toggle DevTools
- `F5` / `Ctrl+R`: Reload
- `Ctrl+Shift+R`: Force Reload

## License
This project is licensed under the [MIT License](file:///home/bn/projects/teams-linux/LICENSE).
