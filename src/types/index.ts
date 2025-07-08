/**
 * Updater configuration options.
 */
export interface UpdaterConfig {
    /** GitHub repo in the form 'owner/repo' */
    repo: string;
    /** Automatically download updates when available (default: true) */
    autoDownload?: boolean;
    /** Allow prerelease versions (default: false) */
    allowPrerelease?: boolean;
    /** Release channel/tag to use (default: 'latest') */
    channel?: string;
    /** Custom logger (defaults to console) */
    logger?: Logger;
    /** Enable verbose debug output (default: false) */
    debug?: boolean;
    // Add more config options as needed
}

/**
 * Information about an available update from GitHub Releases.
 */
export interface UpdateInfo {
    /** Version string (from tag_name) */
    version: string;
    /** Release name */
    releaseName: string;
    /** Release notes (body) */
    releaseNotes: string;
    /** Assets for this release */
    assets: Array<{
        /** Asset file name */
        name: string;
        /** Download URL */
        url: string;
        /** Optional SHA256 hash for validation */
        sha256?: string;
        /** Optional GPG signature URL */
        gpgSignatureUrl?: string;
    }>;
}

/**
 * Event callbacks for Updater.
 */
export interface UpdateEvents {
    /** Emitted when an update is available */
    "update-available": (info: UpdateInfo) => void;
    /** Emitted when no update is available */
    "update-not-available": () => void;
    /** Emitted during download progress */
    "download-progress": (progress: { percent: number; transferred: number; total: number }) => void;
    /** Emitted when download is complete */
    downloaded: (filePath: string) => void;
    /** Emitted on any error */
    error: (err: Error) => void;
    [event: string]: (...args: any[]) => void; // Index signature for compatibility
}

/**
 * Logger interface for custom logging.
 */
export interface Logger {
    info(...args: any[]): void;
    warn(...args: any[]): void;
    error(...args: any[]): void;
    debug?(...args: any[]): void;
}
