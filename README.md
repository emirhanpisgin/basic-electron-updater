# basic-electron-updater

A cross-platform auto-update library for Electron Forge apps using GitHub Releases.

## Features

-   **Cross-platform:** Windows, macOS, Linux
-   **Signed update manifests:** Ed25519-authenticated release metadata with application-pinned public keys; unsigned updates are rejected by default
-   **Mandatory integrity:** signed SHA-256 and size checks before download completion and again before launch
-   **Hardened downloads:** HTTPS-only, redirect/private-host checks, host allow-list, size caps and timeouts
-   **Event-based API:** update-available, download-progress, downloaded, error
-   **Cancellation and timeouts:** optional `AbortSignal` and `timeoutMs` on checks and downloads
-   **Exact release-asset policy for legacy mode**
-   **Manual & automatic update checking**
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
    // Replace with the product's pinned Ed25519 public key.
    security: {
        publicKeys: [
            {
                keyId: "release-2026-01",
                publicKey: "<base64 SPKI Ed25519 public key>",
            },
        ],
    },
    autoDownload: false,
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

await updater.checkForUpdates();
```

Secure mode requires a signed `update-manifest.json` and detached
`update-manifest.json.sig` in the release. See
[`SECURITY.md`](SECURITY.md), [`docs/SIGNING.md`](docs/SIGNING.md) and
[`docs/THREAT_MODEL.md`](docs/THREAT_MODEL.md).

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
-   `assetPolicy`: Explicit release-asset contract for legacy/unsigned mode (see below)
-   `security`: Signed-manifest and download-security policy (secure by default)

### Update security

Secure mode is the default. The application pins one or more Ed25519 public keys;
releases must publish an exact-byte signed manifest and signature. The manifest
binds the app, version, channel, platform, architecture, expiry, installer name,
size and SHA-256. `checkForUpdates()` verifies it before `update-available`;
`downloadUpdate()` verifies the installer and never falls back to unsigned bytes.

See [`SECURITY.md`](SECURITY.md) for guarantees and non-guarantees,
[`docs/SIGNING.md`](docs/SIGNING.md) for the manifest/signing process, and
[`docs/MIGRATION.md`](docs/MIGRATION.md) for legacy migration.

Windows Authenticode is **not implemented by the library**. Applications may
supply `security.authenticodeVerifier` and `security.expectedWindowsPublisher`;
verification failure blocks launch.

### Asset policy (legacy mode)

`assetPolicy` applies only when unsigned legacy updates are explicitly enabled.
Signed manifests select the installer by the authenticated manifest asset name,
not by this naming contract.

`downloadUpdate()` selects exactly one asset that matches the configured product,
platform and architecture in legacy mode. It no longer picks the first broad
Windows-name match.

```ts
const updater = new Updater({
    repo: "MelodifyApp/melodify",
    security: {
        allowUnsignedUpdates: true,
        requireManifestSignature: false,
        requireSha256: false,
    },
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
`TimeoutError` and emits `error`. Omitting the options preserves the
non-cancellable behavior.

In secure mode, invalid/missing/expired manifests reject with
`UpdateSecurityError` before `update-available`. Installer hash/size/signature
failures reject before `downloaded` and before `applyUpdate()` launches anything.
`AssetSelectionError` remains the fail-closed error for the legacy asset policy.

## Security

-   Secure mode requires a detached Ed25519 signature over the exact manifest
    bytes, verified against an application-pinned key. The release channel cannot
    add or replace that key.
-   Signed SHA-256 and size are mandatory and are re-checked before launch.
-   Downloads use HTTPS, a configurable host allow-list, private/loopback
    rejection, redirect validation, maximum sizes and timeouts.
-   Windows Authenticode/publisher verification is **not implemented in the
    library**; `security.authenticodeVerifier` is an application-supplied hook.
-   GitHub API digests and filenames are untrusted metadata. HTTPS, a GitHub
    digest or a filename does not establish publisher identity.
-   Legacy unsigned mode is explicit (`allowUnsignedUpdates: true`), warns, and
    is not a security guarantee. It must not be presented as signature
    verification.
-   A compromised signing key, a same-user/local attacker, DNS rebinding and the
    final verification-to-exec race remain outside the library's guarantees.

See [`SECURITY.md`](SECURITY.md) for the full policy and
[`SECURITY_AUDIT.md`](SECURITY_AUDIT.md) for the audit and residual risks.

## Example: Electron Forge Integration

1.  Add to your main process:

    ```ts
    import Updater from "basic-electron-updater";
    const updater = new Updater({
        repo: "your/repo",
        security: {
            publicKeys: [
                {
                    keyId: "release-2026-01",
                    publicKey: "<base64 SPKI Ed25519 public key>",
                },
            ],
        },
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
