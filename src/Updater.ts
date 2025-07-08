import { TypedEventEmitter } from "./events";
import { UpdaterConfig, UpdateInfo, UpdateEvents } from "./types";
import { GitHubProvider } from "./github/GitHubProvider";
import { resolveConfig } from "./config";
import { Downloader } from "./download/Downloader";
import * as os from "os";
import * as path from "path";
import { applyWindowsUpdate } from "./platform/windows";
import { applyMacUpdate } from "./platform/macos";
import { applyLinuxUpdate } from "./platform/linux";

/**
 * Updater provides secure, cross-platform auto-update support for Electron Forge apps using GitHub Releases.
 *
 * @example
 * import Updater from 'my-auto-updater';
 * const updater = new Updater({ repo: 'user/repo' });
 * updater.on('update-available', info => { ... });
 * updater.checkForUpdates();
 */
export default class Updater extends TypedEventEmitter<UpdateEvents> {
    private config: Required<UpdaterConfig>;
    private githubProvider: GitHubProvider;
    private downloader: Downloader;
    private lastUpdateInfo: UpdateInfo | null = null;
    private lastDownloadedPath: string | null = null;

    /**
     * Create a new Updater instance.
     * @param config Updater configuration options
     */
    constructor(config: UpdaterConfig) {
        super();
        this.config = resolveConfig(config);
        this.githubProvider = new GitHubProvider({
            repo: this.config.repo,
            allowPrerelease: this.config.allowPrerelease,
            channel: this.config.channel,
        });
        this.downloader = new Downloader();
    }

    /**
     * Checks GitHub Releases for the latest update.
     * Emits 'update-available' or 'update-not-available'.
     * @returns UpdateInfo if available, otherwise null
     */
    async checkForUpdates(): Promise<UpdateInfo | null> {
        try {
            this.config.logger.info("Checking for updates...");
            const info = await this.githubProvider.getLatestRelease();
            this.lastUpdateInfo = info;
            if (info) {
                this.emit("update-available", info);
                this.config.logger.info("Update available:", info.version);
                if (this.config.autoDownload) {
                    // Optionally trigger downloadUpdate here
                }
                return info;
            } else {
                this.emit("update-not-available");
                this.config.logger.info("No update available.");
                return null;
            }
        } catch (err: any) {
            this.emit("error", err);
            this.config.logger.error("Update check failed:", err);
            return null;
        }
    }

    /**
     * Downloads the update asset for the current platform.
     * Emits 'download-progress' and 'downloaded'.
     * Validates SHA256 and GPG signature if provided.
     * @returns Path to the downloaded file
     * @throws Error if download or validation fails
     */
    async downloadUpdate(): Promise<string> {
        if (!this.lastUpdateInfo) {
            throw new Error("No update info available. Call checkForUpdates() first.");
        }
        // Select asset for current platform
        const platform = os.platform();
        const arch = os.arch();
        const asset = this.lastUpdateInfo.assets.find((a) => {
            const n = a.name.toLowerCase();
            if (platform === "win32") return n.endsWith(".exe") || n.endsWith(".nsis.zip");
            if (platform === "darwin") return n.endsWith(".dmg") || n.endsWith(".zip");
            if (platform === "linux")
                return n.endsWith(".AppImage") || n.endsWith(".tar.gz") || n.endsWith(".deb") || n.endsWith(".rpm");
            return false;
        });
        if (!asset) throw new Error("No suitable asset found for platform: " + platform);
        const dest = path.join(os.tmpdir(), asset.name);
        this.config.logger.info("Downloading update asset:", asset.url);
        try {
            const filePath = await this.downloader.downloadAsset(
                asset.url,
                dest,
                (progress) => this.emit("download-progress", progress),
                asset.sha256
            );
            // GPG signature validation if present
            if (asset.gpgSignatureUrl) {
                const sigDest = dest + ".sig";
                await this.downloader.downloadAsset(asset.gpgSignatureUrl, sigDest);
                try {
                    await this.downloader.validateGpg(filePath, sigDest);
                    this.config.logger.info("GPG signature validated for", filePath);
                } catch (err: any) {
                    this.emit("error", err);
                    this.config.logger.error("GPG validation failed:", err);
                    throw err;
                }
            }
            this.emit("downloaded", filePath);
            this.config.logger.info("Downloaded update to:", filePath);
            this.lastDownloadedPath = filePath;
            return filePath;
        } catch (err: any) {
            this.emit("error", err);
            this.config.logger.error("Download failed:", err);
            throw err;
        }
    }

    /**
     * Applies the downloaded update by launching the installer or archive.
     * Handles platform-specific logic.
     * @throws Error if no update is downloaded or launching fails
     */
    async applyUpdate(): Promise<void> {
        if (!this.lastDownloadedPath) {
            throw new Error("No downloaded update to apply. Call downloadUpdate() first.");
        }
        const platform = os.platform();
        this.config.logger.info("Applying update for platform:", platform);
        try {
            if (platform === "win32") {
                await applyWindowsUpdate(this.lastDownloadedPath);
            } else if (platform === "darwin") {
                await applyMacUpdate(this.lastDownloadedPath);
            } else if (platform === "linux") {
                await applyLinuxUpdate(this.lastDownloadedPath);
            } else {
                throw new Error("Unsupported platform: " + platform);
            }
            this.config.logger.info("Update applied (installer launched).");
        } catch (err: any) {
            this.emit("error", err);
            this.config.logger.error("Failed to apply update:", err);
            throw err;
        }
    }
}
