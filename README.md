# basic-electron-updater

A secure, cross-platform auto-update library for Electron Forge apps using GitHub Releases.

## Features

-   **Cross-platform:** Windows, macOS, Linux
-   **Secure:** HTTPS-only, SHA256, optional GPG, code-signing validation
-   **Event-based API:** update-available, download-progress, downloaded, error
-   **Manual & automatic update checking**
-   **Easy integration:** import, instantiate, call methods
-   **Electron >=27 support**
-   **No electron-builder/electron-updater dependency**

## Quick Start

```sh
npm install basic-electron-updater
```

```ts
import Updater from "basic-electron-updater";

const updater = new Updater({
    repo: "username/repo",
    autoDownload: true,
    allowPrerelease: false,
    channel: "latest",
});

updater.on("update-available", (info) => {
    // Show UI or log info
});
updater.on("download-progress", (progress) => {
    // Show progress bar
});
updater.on("downloaded", (file) => {
    // Prompt user to restart/apply
});
updater.on("error", (err) => {
    // Handle errors
});

updater.checkForUpdates();
```

## API

### `new Updater(config: UpdaterConfig)`

-   `repo` (**required**): GitHub repo, e.g. `user/repo`
-   `autoDownload`: Automatically download updates (default: true)
-   `allowPrerelease`: Allow prerelease versions (default: false)
-   `channel`: Release channel/tag (default: 'latest')
-   `logger`: Custom logger (defaults to console)

### Events

-   `update-available`: `(info: UpdateInfo)` — New update found
-   `update-not-available`: `()` — No update found
-   `download-progress`: `(progress)` — Download progress
-   `downloaded`: `(filePath)` — Download complete
-   `error`: `(err)` — Any error

### Methods

-   `checkForUpdates(): Promise<UpdateInfo | null>` — Check for updates
-   `downloadUpdate(): Promise<string>` — Download update asset
-   `applyUpdate(): Promise<void>` — Launch installer/apply update

## Security

-   All downloads use HTTPS
-   SHA256 hash validation (if provided)
-   Optional GPG signature validation
-   Code-signing validation (macOS/Windows, planned)

## Example: Electron Forge Integration

1.  Add to your main process:

    ```ts
    import Updater from "basic-electron-updater";
    const updater = new Updater({ repo: "your/repo" });
    updater.on("update-available", (info) => {
        /* ... */
    });
    app.on("ready", () => updater.checkForUpdates());
    ```

2.  Upload your release assets to GitHub Releases (installer, .dmg, .AppImage, etc)

## License

MIT

---

[GitHub Repository](https://github.com/emirhanpisgin/basic-electron-updater)
[Issues](https://github.com/emirhanpisgin/basic-electron-updater/issues)
