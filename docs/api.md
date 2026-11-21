# basic-electron-updater API Reference

## Updater

### Constructor

```
new Updater(config: UpdaterConfig)
```

- `config.repo` (string, required): GitHub repo, e.g. `user/repo`
- `config.autoDownload` (boolean): Automatically download updates (default: true)
- `config.allowPrerelease` (boolean): Allow prerelease versions (default: false)
- `config.channel` (string): Release channel/tag (default: 'latest')
- `config.logger` (Logger): Custom logger (defaults to console)
- `config.assetPolicy` (AssetPolicy): Explicit release-asset contract for legacy/unsigned mode
- `config.security` (SecurityOptions): Signed-manifest and download-security policy; secure by default

### Methods

#### `checkForUpdates(options?: UpdateOptions): Promise<UpdateInfo | null>`
Checks GitHub Releases for the latest update. Emits `update-available` or `update-not-available`.

-   In secure mode the signed manifest is downloaded and verified before
    `update-available`. Invalid, missing, expired, wrong-app/version/platform/
    architecture/channel manifests reject with `UpdateSecurityError`; no update
    event is emitted.
-   Without options, ordinary network failures emit `error` and resolve to `null`
    in legacy mode. Secure mode applies a default operation timeout.
-   If `options.signal` is aborted, the promise rejects with an Error named `AbortError`.
-   If `options.timeoutMs` expires, the promise rejects with an Error named `TimeoutError` and emits `error`.

#### `downloadUpdate(options?: UpdateOptions): Promise<string>`
Downloads the update asset for the current platform. Emits `download-progress` and `downloaded`.

-   Secure mode requires a verified signed manifest. The installer is written to
    a private staging directory, and its signed size/SHA-256 are checked during
    download and again before the path is returned. No unsigned fallback exists.
-   On caller abort the promise rejects with `AbortError`, partial files are removed, `downloaded` is not emitted, and the stored download path is cleared.
-   On timeout the promise rejects with `TimeoutError`, partial files are removed, and `error` is emitted.
-   A cancelled or timed-out new attempt never leaves an older downloaded path marked for `applyUpdate()`.
-   Concurrent downloads reject with `UpdateSecurityError` code `CONCURRENT_UPDATE`.
-   Legacy mode uses the exact `assetPolicy`; it requires an explicit
    `allowUnsignedUpdates` opt-in and does not verify a publisher signature.
-   Asset selection failures reject with `AssetSelectionError` (`NO_MATCH` /
    `AMBIGUOUS`) before any download.

#### `applyUpdate(): Promise<void>`
Applies the downloaded update by launching the installer or archive. Handles platform-specific logic.

In secure mode it re-checks the artifact's path, size and SHA-256 and runs the
optional Authenticode verifier before launch. A failure rejects without launching;
concurrent launches reject with `CONCURRENT_UPDATE`. Installer arguments are never
taken from release metadata.

### UpdateOptions

```ts
interface UpdateOptions {
  /** Cancels the operation. Abort rejects with an Error named AbortError. */
  signal?: AbortSignal;
  /** Positive, finite overall timeout in milliseconds. */
  timeoutMs?: number;
}
```

Both fields are optional. `timeoutMs` must be a positive finite number, otherwise the method rejects with a `RangeError`. Cancellation destroys the request, response and file streams, removes partial files, and settles the promise once.

### SecurityOptions

```ts
interface TrustedPublicKey {
  keyId: string;
  publicKey: string; // base64 SPKI DER or PEM Ed25519 public key
}

interface SecurityOptions {
  publicKeys?: TrustedPublicKey[];
  requireManifestSignature?: boolean; // default true
  allowUnsignedUpdates?: boolean;     // default false; legacy opt-in
  requireSha256?: boolean;            // default true
  manifestAssetName?: string;         // default "update-manifest.json"
  manifestSignatureAssetName?: string;// default "update-manifest.json.sig"
  appId?: string;                     // default repo
  allowedDownloadHosts?: string[];    // default GitHub asset hosts
  maxDownloadBytes?: number;          // default 512 MiB
  maxManifestBytes?: number;          // default 64 KiB
  requestTimeoutMs?: number;          // default 30 s
  operationTimeoutMs?: number;        // default 5 min
  authenticodeVerifier?: (installerPath: string, expectedPublisher?: string) => Promise<void>;
  expectedWindowsPublisher?: string;
  requireAuthenticode?: boolean;
}
```

Secure defaults require `publicKeys` and reject unsigned updates. Legacy mode
requires `allowUnsignedUpdates: true` and `requireManifestSignature: false`; it
logs a warning and is not a publisher-authenticity guarantee. The library does
not implement Authenticode; a supplied verifier must throw on unsigned or
unexpected-publisher installers. See [`../SECURITY.md`](../SECURITY.md) and
[`SIGNING.md`](SIGNING.md).

Security failures throw `UpdateSecurityError` (`.code`) or
`SecurityConfigError` (configuration). Error codes include `INVALID_SIGNATURE`,
`UNKNOWN_KEY`, `INVALID_MANIFEST`, `EXPIRED_MANIFEST`, `DOWNGRADE`,
`HASH_MISMATCH`, `SIZE_MISMATCH`, `UNSAFE_ASSET`, `UNSAFE_URL`,
`CONCURRENT_UPDATE` and `AUTHENTICODE_FAILED`. The manifest format is documented
in [`SIGNING.md`](SIGNING.md).

### AssetPolicy

`assetPolicy` applies to explicit legacy/unsigned mode. Signed mode selects the
installer by the authenticated manifest asset name, not by this naming contract.

```ts
type AssetPlatform = "win32" | "darwin" | "linux";
type AssetArch = "x64" | "ia32" | "arm64" | "arm";

interface AssetPolicy {
  product?: string;
  platform?: AssetPlatform;
  arch?: AssetArch;
  legacyAssetName?: string | null;
}
```

-   `product` must begin the asset name. It defaults to the repository name.
-   `platform` and `arch` default to the runtime values. When supplied they must match the runtime; a mismatch rejects with `POLICY_MISMATCH`.
-   Tokenized names carry the architecture, for example `Melodify-1.0.7-win32-x64.exe`. Platform tokens such as `win32`, `windows`, `mac`, `osx` and `linux` are accepted; the platform-specific installer extension also identifies the platform.
-   Windows supported installer formats are `.exe`, `.msi` and `.nsis.zip`. macOS and Linux keep their existing extensions.
-   On Windows, the exact legacy name `<product>.Setup.exe` is accepted only when no architecture-specific asset for the same platform exists. Set `legacyAssetName` to override it, or `null` to disable it. Other platforms have no default legacy name.
-   Exactly one asset must match. Two equally valid assets, mixed legacy/architecture-specific assets, or a malformed/mixed name reject with `AMBIGUOUS`; no match rejects with `NO_MATCH`. The error exposes `.code` and `.assets`, and no download is attempted.

This is asset selection, not publisher authentication. It makes no Authenticode, signing-key or TOCTOU claim.

### Events

- `update-available` (info: UpdateInfo): New update found
- `update-not-available` (): No update found
- `download-progress` (progress): Download progress
- `downloaded` (filePath): Download complete
- `error` (err: Error): Any error

## Types

### UpdaterConfig
```
interface UpdaterConfig {
  repo: string;
  autoDownload?: boolean;
  allowPrerelease?: boolean;
  channel?: string;
  logger?: Logger;
  debug?: boolean;
  assetPolicy?: AssetPolicy;
  security?: SecurityOptions;
}
```

### UpdateInfo
```
interface UpdateInfo {
  version: string;
  releaseName: string;
  releaseNotes: string;
  assets: Array<{
    name: string;
    url: string;
    size?: number;
    sha256?: string;
    gpgSignatureUrl?: string;
  }>;
}
```

### Logger
```
interface Logger {
  info(...args: any[]): void;
  warn(...args: any[]): void;
  error(...args: any[]): void;
  debug?(...args: any[]): void;
}
```

## Security
- Secure mode requires an Ed25519-signed manifest and a pinned application key.
- Signed SHA-256 and size are mandatory and re-checked before launch.
- Downloads enforce HTTPS, allow-listed hosts, private-address rejection, redirect validation, size limits and timeouts.
- Windows Authenticode/publisher verification is not built in; `authenticodeVerifier` is an application hook.
- GitHub `digest` is unauthenticated metadata; it is never a substitute for the signed manifest hash.
- Legacy unsigned mode is explicit, warns, and is not publisher authentication.
- See [`../SECURITY.md`](../SECURITY.md) and [`THREAT_MODEL.md`](THREAT_MODEL.md) for residual risks.
