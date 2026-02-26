# Microsoft Teams Linux Wrapper

A lightweight, native-feeling Microsoft Teams wrapper for Linux built with Electron.

## Features

- **Native System Tray**: Minimize to tray, quick access menu, and unread message indicators.
- **Window State Persistence**: Automatically restores your last window size and position.
- **Single Instance Lock**: Prevents multiple instances of the app from running.
- **Global Shortcut**: Press `Alt+Shift+T` to quickly show or hide the application from anywhere.
- **Secure Context**: Runs in a sandboxed environment with strict permissions.
- **Linux Optimized**: Includes workarounds for common Linux-specific Electron issues (GTK fonts, WebRTC).

## Installation

### Prerequisites

- Node.js (v16 or higher)
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

## Shortcuts

- `Alt+Shift+T`: Toggle Visibility
- `Ctrl+W`: Close to Tray (while app is focused)

## License

MIT
