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

#### `checkForUpdates(): Promise<UpdateInfo | null>`
Checks GitHub Releases for the latest update. Emits `update-available` or `update-not-available`.

#### `downloadUpdate(): Promise<string>`
Downloads the update asset for the current platform. Emits `download-progress` and `downloaded`. Validates SHA256 and GPG signature if provided.

#### `applyUpdate(): Promise<void>`
Applies the downloaded update by launching the installer or archive. Handles platform-specific logic.

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
- All downloads use HTTPS
- SHA256 hash validation (if provided)
- Optional GPG signature validation
- Code-signing validation (planned)
