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

### Methods

#### `checkForUpdates(options?: UpdateOptions): Promise<UpdateInfo | null>`
Checks GitHub Releases for the latest update. Emits `update-available` or `update-not-available`.

-   Without options, ordinary failures emit `error` and resolve to `null` (unchanged behavior).
-   If `options.signal` is aborted, the promise rejects with an Error named `AbortError`; no check result is emitted.
-   If `options.timeoutMs` expires, the promise rejects with an Error named `TimeoutError` and emits `error`.

#### `downloadUpdate(options?: UpdateOptions): Promise<string>`
Downloads the update asset for the current platform. Emits `download-progress` and `downloaded`. May validate SHA256/GPG when the release metadata supplies compatible fields; this is not a publisher-authenticity check.

-   On caller abort the promise rejects with `AbortError`, partial files are removed, `downloaded` is not emitted, and the stored download path is cleared.
-   On timeout the promise rejects with `TimeoutError`, partial files are removed, and `error` is emitted.
-   A cancelled or timed-out new attempt never leaves an older downloaded path marked for `applyUpdate()`.
-   Omitting options preserves the previous behavior.

#### `applyUpdate(): Promise<void>`
Applies the downloaded update by launching the installer or archive. Handles platform-specific logic.

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
- All downloads use HTTPS.
- SHA256/GPG validation is optional and metadata-dependent; GitHub's `digest` field is not currently mapped, so it is often inactive.
- Code signing is planned, not implemented.
- These checks do not establish publisher identity (no pinned key) and occur after download.
