# basic-electron-updater

A cross-platform auto-update library for Electron Forge apps using GitHub Releases.

## Features

-   **Cross-platform:** Windows, macOS, Linux
-   **HTTPS-only downloads** with optional SHA256/GPG checks when release metadata supplies compatible fields; code signing and publisher verification are not implemented
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
-   `assetPolicy`: Explicit release-asset contract (see below)

### Asset policy

`downloadUpdate()` selects exactly one asset that matches the configured product,
platform and architecture. It no longer picks the first broad Windows-name
match.

```ts
const updater = new Updater({
    repo: "MelodifyApp/melodify",
    assetPolicy: {
        product: "Melodify",
        // platform defaults to the runtime platform
        // arch defaults to the runtime architecture
    },
});
```

-   A matching asset starts with the product token and the supported installer
    extension for the platform, then carries the runtime architecture token,
    e.g. `Melodify-1.0.7-win32-x64.exe`.
-   The product defaults to the repository name. `platform` and `arch` default
    to the runtime values and must match them when set.
-   Windows accepts `.exe`, `.msi` and `.nsis.zip`; macOS and Linux keep their
    existing extensions.
-   On Windows, the exact legacy name `<product>.Setup.exe` is accepted when no
    architecture-specific asset for the same platform is present. Set
    `legacyAssetName` to another exact name, or `null` to disable legacy
    matching.
-   Zero matches, multiple equally valid matches, and mixed legacy/current
    assets fail with an `AssetSelectionError` before any download starts.

This is an asset-selection contract only. It does not add Authenticode,
publisher-key verification, or a TOCTOU guarantee.

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
-   SHA256 and GPG checks are optional and depend on release metadata exposing compatible fields. GitHub's `digest` field is not mapped by the current provider, so these checks are normally inactive.
-   Code signing and publisher verification are not implemented.
-   Asset selection and these checks are integrity aids, not publisher-authenticity guarantees: no publisher key is pinned, and the downloaded file is written before validation.

## Example: Electron Forge Integration

1.  Add to your main process:

    ```ts
    import Updater from "basic-electron-updater";
    const updater = new Updater({
        repo: "your/repo",
        assetPolicy: { product: "YourProduct" },
    });
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
