import { ipcMain, webContents } from "electron";
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
import * as semver from "semver";

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
    private currentVersion: string;
    private debug: boolean;

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
        this.currentVersion = this.detectAppVersion();
        this.debug = !!config.debug;
        if (this.debug) {
            this.sendDebugLog("[Updater:debug] Initialized with config:", this.config);
            this.sendDebugLog("[Updater:debug] Current version:", this.currentVersion);
        }
    }

    private sendDebugLog(message: string, ...args: any[]): void {
        if (!this.debug) return;
        // Print to main process console
        // eslint-disable-next-line no-console
        console.debug(message, ...args);
        // Send to all renderer processes if Electron IPC is available
        try {
            if (typeof ipcMain !== "undefined" && webContents.getAllWebContents) {
                for (const wc of webContents.getAllWebContents()) {
                    wc.send("basic-electron-updater:debug", message, ...args);
                }
            }
        } catch {
            // Ignore errors when not in Electron context
        }
    }

    private detectAppVersion(): string {
        try {
            // Only works in Electron main process
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const electron = require("electron");
            const version = electron.app.getVersion();
            if (this.debug) this.sendDebugLog("[Updater:debug] Detected Electron app version:", version);
            return version;
        } catch {
            if (this.debug) this.sendDebugLog("[Updater:debug] Could not detect Electron app version, using 0.0.0");
            return "0.0.0";
        }
    }

    /**
     * Checks GitHub Releases for the latest update.
     * Emits 'update-available' or 'update-not-available'.
     * @returns UpdateInfo if available, otherwise null
     */
    async checkForUpdates(): Promise<UpdateInfo | null> {
        try {
            this.emit("checking-for-update");
            this.config.logger.info("Checking for updates...");
            if (this.debug) this.sendDebugLog("[Updater:debug] Calling getLatestRelease...");
            const info = await this.githubProvider.getLatestRelease();
            if (this.debug) {
                this.sendDebugLog("[Updater:debug] Latest release info:", info);
                this.sendDebugLog("[Updater:debug] Current version:", this.currentVersion);
            }
            this.lastUpdateInfo = info;
            if (info && semver.valid(info.version) && semver.valid(this.currentVersion) && 
                semver.gt(info.version, this.currentVersion)) {
                if (this.debug) this.sendDebugLog("[Updater:debug] Update available:", info.version);
                this.emit("update-available", info);
                this.config.logger.info("Update available:", info.version);
                if (this.config.autoDownload) {
                    this.downloadUpdate();
                }
                return info;
            } else {
                if (this.debug) this.sendDebugLog("[Updater:debug] No update available.");
                this.emit("update-not-available");
                this.config.logger.info("No update available.");
                return null;
            }
        } catch (err: unknown) {
            const error = err instanceof Error ? err : new Error(String(err));
            if (this.debug) this.sendDebugLog("[Updater:debug] Error in checkForUpdates:", error);
            this.emit("error", error);
            this.config.logger.error("Update check failed:", error);
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
        const platform = os.platform();
        const arch = os.arch();
        if (this.debug) {
            this.sendDebugLog("[Updater:debug] Platform:", platform, "Arch:", arch);
            this.sendDebugLog("[Updater:debug] Assets:", this.lastUpdateInfo.assets);
        }
        // Select asset for current platform
        const asset = this.lastUpdateInfo.assets.find((a) => {
            const n = a.name.toLowerCase();
            if (platform === "win32") {
                return n.endsWith(".exe") || n.endsWith(".msi") || n.endsWith(".nsis.zip") || 
                       n.includes("win") || n.includes("windows") || n.includes("setup");
            }
            if (platform === "darwin") {
                return n.endsWith(".dmg") || n.endsWith(".zip") || n.endsWith(".pkg") ||
                       n.includes("mac") || n.includes("darwin") || n.includes("osx");
            }
            if (platform === "linux") {
                return n.endsWith(".appimage") || n.endsWith(".tar.gz") || n.endsWith(".deb") || 
                       n.endsWith(".rpm") || n.endsWith(".snap") || n.includes("linux");
            }
            return false;
        });
        if (!asset) throw new Error("No suitable asset found for platform: " + platform);
        const dest = path.join(os.tmpdir(), asset.name);
        if (this.debug) {
            this.sendDebugLog("[Updater:debug] Downloading asset:", asset.url);
            this.sendDebugLog("[Updater:debug] Download destination:", dest);
        }
        this.config.logger.info("Downloading update asset:", asset.url);
        try {
            const filePath = await this.downloader.downloadAsset(
                asset.url,
                dest,
                (progress) => {
                    if (this.debug) this.sendDebugLog("[Updater:debug] Download progress:", progress);
                    this.emit("download-progress", progress);
                },
                asset.sha256
            );
            // GPG signature validation if present
            if (asset.gpgSignatureUrl) {
                const sigDest = dest + ".sig";
                if (this.debug) this.sendDebugLog("[Updater:debug] Downloading GPG signature:", asset.gpgSignatureUrl);
                await this.downloader.downloadAsset(asset.gpgSignatureUrl, sigDest, undefined, undefined);
                try {
                    await this.downloader.validateGpg(filePath, sigDest);
                    if (this.debug) this.sendDebugLog("[Updater:debug] GPG signature validated for", filePath);
                    this.config.logger.info("GPG signature validated for", filePath);
                } catch (err: unknown) {
                    const error = err instanceof Error ? err : new Error(String(err));
                    if (this.debug) this.sendDebugLog("[Updater:debug] GPG validation failed:", error);
                    this.emit("error", error);
                    this.config.logger.error("GPG validation failed:", error);
                    throw error;
                }
            }
            this.emit("downloaded", filePath);
            this.config.logger.info("Downloaded update to:", filePath);
            this.lastDownloadedPath = filePath;
            return filePath;
        } catch (err: unknown) {
            const error = err instanceof Error ? err : new Error(String(err));
            if (this.debug) this.sendDebugLog("[Updater:debug] Download failed:", error);
            this.emit("error", error);
            this.config.logger.error("Download failed:", error);
            throw error;
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
        if (this.debug) this.sendDebugLog("[Updater:debug] Applying update for platform:", platform);
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
            if (this.debug) this.sendDebugLog("[Updater:debug] Update applied (installer launched).");
            this.config.logger.info("Update applied (installer launched).");
        } catch (err: unknown) {
            const error = err instanceof Error ? err : new Error(String(err));
            if (this.debug) this.sendDebugLog("[Updater:debug] Failed to apply update:", error);
            this.emit("error", error);
            this.config.logger.error("Failed to apply update:", error);
            throw error;
        }
    }
}
