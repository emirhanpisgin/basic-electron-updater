# basic-electron-updater

A secure, cross-platform auto-update library for Electron Forge apps using GitHub Releases.

## Features

-   **Cross-platform:** Windows, macOS, Linux
-   **HTTPS-only downloads** with optional SHA256/GPG checks when release metadata supplies compatible fields; code signing is planned, not implemented
-   **Event-based API:** update-available, download-progress, downloaded, error
-   **Cancellation and timeouts:** optional `AbortSignal` and `timeoutMs` on checks and downloads
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

### Cancel or bound an operation

```ts
const controller = new AbortController();
// Call controller.abort() from your app's shutdown/cancel handler.

try {
    await updater.checkForUpdates({
        signal: controller.signal,
        timeoutMs: 30_000,
    });
} catch (error) {
    if ((error as Error).name === "AbortError") return;
    throw error;
}
```

Aborting never emits `downloaded` and clears the downloaded path. A timeout
rejects with an Error named `TimeoutError` and also emits `error`. Both options
are optional; omitting them keeps the previous behavior.

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

-   `checkForUpdates(options?: UpdateOptions): Promise<UpdateInfo | null>` — Check for updates
-   `downloadUpdate(options?: UpdateOptions): Promise<string>` — Download update asset
-   `applyUpdate(): Promise<void>` — Launch installer/apply update

`UpdateOptions` is `{ signal?: AbortSignal; timeoutMs?: number }`. A caller
abort rejects with an Error named `AbortError`; a timeout rejects with
`TimeoutError` and emits `error`. Omitting the options preserves the old
non-cancellable behavior.

## Security

-   All downloads use HTTPS.
-   SHA256 and GPG checks are optional and depend on release metadata exposing compatible fields. GitHub's `digest` field is not mapped by the current provider, so these checks are often inactive.
-   Code signing is planned, not implemented.
-   These checks are integrity aids, not publisher-authenticity guarantees: no publisher key is pinned, and the downloaded file is written before validation.

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
