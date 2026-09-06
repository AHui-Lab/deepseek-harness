# DeepSeek Harness Desktop

An Electron desktop wrapper for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`) providing a native desktop experience.

## Features

- **One-click Launch**: Double-click to open, automatically starts `dsh web` server in background
- **Native Window**: Run Web UI in a standalone desktop window without browser tabs
- **System Tray**: Minimize to tray, keep running in background
- **Auto Update Check**: Automatically checks for new upstream versions on startup and every 24 hours
- **Version Tracking**: Tracks releases from `deepseek-ai/deepseek-harness` upstream repository

## Development

```bash
# From project root
pnpm install
cd apps/desktop

# Dev mode (requires dsh to be built first)
pnpm run dev

# Build
pnpm run build
```

## Usage

### Option 1: Run from Source

```bash
# 1. Make sure project dependencies are installed and built
cd deepseek-harness
pnpm install
pnpm run build

# 2. Run desktop app
cd apps/desktop
pnpm run start
```

### Option 2: Install Packaged Version

Download the installer for your platform (.exe/.dmg/.AppImage) and double-click to use.

## Update Mechanism

The desktop app periodically checks for new versions from the upstream repository [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness/releases):

1. **Startup Check**: Automatically checks 15 seconds after app launch
2. **Periodic Check**: Checks every 24 hours
3. **Manual Check**: Click "Check for Updates" in the system tray menu

When a new version is found, a system dialog pops up. Click "View Release" to jump to the GitHub Release page.

## File Structure

```
apps/desktop/
├── package.json          # Package config & electron-builder settings
├── src/
│   ├── main.js           # Electron main process
│   ├── preload.js        # Preload script (secure context isolation)
│   ├── updater.js        # GitHub API update checker
│   └── splash.html       # Startup splash screen
└── assets/
    └── icon.png          # App icon
```
