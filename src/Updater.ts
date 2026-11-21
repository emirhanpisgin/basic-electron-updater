import { ipcMain, webContents } from "electron";
import * as crypto from "crypto";
import * as fs from "fs";
import { TypedEventEmitter } from "./events";
import { UpdaterConfig, UpdateInfo, UpdateEvents, UpdateOptions } from "./types";
import { GitHubProvider } from "./github/GitHubProvider";
import { ResolvedUpdaterConfig, resolveConfig } from "./config";
import { DownloadProgress, Downloader, DownloadPolicy } from "./download/Downloader";
import * as os from "os";
import * as path from "path";
import { applyWindowsUpdate } from "./platform/windows";
import { applyMacUpdate } from "./platform/macos";
import { applyLinuxUpdate } from "./platform/linux";
import * as semver from "semver";
import { selectReleaseAsset } from "./assets/selectAsset";
import {
    abortErrorFromSignal,
    createAbortContext,
    isAbortError,
    isTimeoutError,
    toError,
} from "./utils/abort";
import {
    SignedUpdateManifest,
    VerifiedUpdateManifest,
    verifySignedManifest,
} from "./security/manifest";
import { UpdateSecurityError } from "./security/errors";
import { assertSafeAssetName, isPathInsideDirectory } from "./utils/paths";

export interface UpdaterDependencies {
    githubProvider?: {
        getLatestRelease(options?: UpdateOptions): Promise<UpdateInfo | null>;
    };
    downloader?: {
        downloadAsset(
            url: string,
            dest: string,
            onProgress?: (progress: DownloadProgress) => void,
            expectedSha256?: string,
            options?: UpdateOptions,
            policy?: DownloadPolicy
        ): Promise<string>;
        validateGpg?(
            filePath: string,
            sigPath: string,
            keyringPath?: string,
            options?: UpdateOptions
        ): Promise<void>;
    };
    /** Test/integration seam; defaults to the platform launcher. */
    applyUpdate?(installerPath: string, platform: string): Promise<void>;
}

interface VerifiedArtifact {
    path: string;
    directory: string;
    size: number;
    sha256: string;
    manifest: SignedUpdateManifest;
}

/**
 * Updater provides cross-platform auto-update support for Electron Forge apps
 * using GitHub Releases. Signed manifests are required by default; legacy
 * unsigned downloads require an explicit security opt-in.
 */
export default class Updater extends TypedEventEmitter<UpdateEvents> {
    private config: ResolvedUpdaterConfig;
    private githubProvider: UpdaterDependencies["githubProvider"];
    private downloader: NonNullable<UpdaterDependencies["downloader"]>;
    private applyPlatform: (installerPath: string, platform: string) => Promise<void>;
    private lastUpdateInfo: UpdateInfo | null = null;
    private lastDownloadedPath: string | null = null;
    private lastVerifiedManifest: VerifiedUpdateManifest | null = null;
    private lastVerifiedArtifact: VerifiedArtifact | null = null;
    private downloadInProgress = false;
    private applyInProgress = false;
    private currentVersion: string;
    private debug: boolean;

    constructor(config: UpdaterConfig, dependencies: UpdaterDependencies = {}) {
        super();
        this.config = resolveConfig(config);
        this.githubProvider =
            dependencies.githubProvider ??
            new GitHubProvider({
                repo: this.config.repo,
                allowPrerelease: this.config.allowPrerelease,
                channel: this.config.channel,
            });
        this.downloader = dependencies.downloader ?? new Downloader();
        this.applyPlatform =
            dependencies.applyUpdate ??
            ((installerPath: string, platform: string): Promise<void> =>
                this.defaultApply(installerPath, platform));
        this.currentVersion = this.detectAppVersion();
        this.debug = !!config.debug;
        if (this.config.security.allowUnsignedUpdates) {
            this.config.logger.warn(
                "basic-electron-updater: UNSIGNED legacy updates are enabled. " +
                    "No publisher signature is verified."
            );
        }
        if (this.debug) {
            this.sendDebugLog("[Updater:debug] Initialized with config:", this.config);
            this.sendDebugLog("[Updater:debug] Current version:", this.currentVersion);
        }
    }

    private sendDebugLog(message: string, ...args: any[]): void {
        if (!this.debug) return;
        // eslint-disable-next-line no-console
        console.debug(message, ...args);
        try {
            if (typeof ipcMain !== "undefined" && webContents.getAllWebContents) {
                for (const wc of webContents.getAllWebContents()) {
                    wc.send("basic-electron-updater:debug", message, ...args);
                }
            }
        } catch {
            // Not in an Electron context.
        }
    }

    private detectAppVersion(): string {
        try {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const electron = require("electron");
            const version = electron.app.getVersion();
            if (this.debug) {
                this.sendDebugLog("[Updater:debug] Detected Electron app version:", version);
            }
            return version;
        } catch {
            if (this.debug) {
                this.sendDebugLog("[Updater:debug] Could not detect Electron app version, using 0.0.0");
            }
            return "0.0.0";
        }
    }

    private effectiveOptions(options: UpdateOptions): UpdateOptions {
        if (
            this.config.security.requireManifestSignature &&
            options.timeoutMs === undefined
        ) {
            return {
                ...options,
                timeoutMs: this.config.security.operationTimeoutMs,
            };
        }
        return options;
    }

    /** Last-line downgrade guard used before download and again before launch. */
    private assertVersionIsNewer(version: string, source: string): void {
        const candidate = semver.valid(version);
        const current = semver.valid(this.currentVersion);
        if (!candidate || !current || !semver.gt(candidate, current)) {
            throw new UpdateSecurityError(
                "DOWNGRADE",
                `Refusing ${source} version ${version}: running version is ${this.currentVersion}`
            );
        }
    }

    private assertManifestFresh(manifest: SignedUpdateManifest): void {
        this.assertVersionIsNewer(manifest.version, "manifest");
        const expiresAt = Date.parse(manifest.expiresAt);
        if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
            throw new UpdateSecurityError(
                "EXPIRED_MANIFEST",
                `Manifest expired at ${manifest.expiresAt}`
            );
        }
    }

    private downloadPolicy(maxBytes: number): DownloadPolicy {
        return {
            allowedHosts: this.config.security.allowedDownloadHosts,
            maxBytes,
            requestTimeoutMs: this.config.security.requestTimeoutMs,
        };
    }

    private findExactAsset(
        info: UpdateInfo,
        name: string,
        code: "MANIFEST_MISSING" | "INVALID_MANIFEST"
    ): UpdateInfo["assets"][number] {
        const matches = info.assets.filter((asset) => asset.name === name);
        if (matches.length !== 1) {
            throw new UpdateSecurityError(
                code,
                `Release must contain exactly one asset named ${name}; found ${matches.length}`
            );
        }
        return matches[0];
    }

    private async fetchVerifiedManifest(
        info: UpdateInfo,
        signal: AbortSignal | undefined
    ): Promise<VerifiedUpdateManifest> {
        const security = this.config.security;
        if (!security.requireManifestSignature) {
            throw new UpdateSecurityError(
                "INSECURE_CONFIG",
                "Signed manifest verification is disabled"
            );
        }

        const manifestAsset = this.findExactAsset(
            info,
            security.manifestAssetName,
            "MANIFEST_MISSING"
        );
        const signatureAsset = this.findExactAsset(
            info,
            security.manifestSignatureAssetName,
            "MANIFEST_MISSING"
        );
        const directory = await fs.promises.mkdtemp(
            path.join(os.tmpdir(), "basic-electron-updater-manifest-")
        );
        try {
            await fs.promises.chmod(directory, 0o700).catch(() => undefined);
            const manifestPath = path.join(directory, "manifest.json");
            const signaturePath = path.join(directory, "manifest.sig");
            await this.downloader.downloadAsset(
                manifestAsset.url,
                manifestPath,
                undefined,
                undefined,
                { signal },
                this.downloadPolicy(security.maxManifestBytes)
            );
            await this.downloader.downloadAsset(
                signatureAsset.url,
                signaturePath,
                undefined,
                undefined,
                { signal },
                this.downloadPolicy(4096)
            );

            const bytes = await fs.promises.readFile(manifestPath);
            const signature = await fs.promises.readFile(signaturePath, "utf8");
            if (bytes.length > security.maxManifestBytes) {
                throw new UpdateSecurityError(
                    "INVALID_MANIFEST",
                    "Manifest exceeds the configured maximum size"
                );
            }

            return verifySignedManifest(
                bytes,
                signature,
                security.parsedPublicKeys,
                {
                    appId: security.appId,
                    version: info.version,
                    platform: os.platform(),
                    architecture: os.arch(),
                    channel: this.config.channel,
                    maxAssetBytes: security.maxDownloadBytes,
                }
            );
        } finally {
            await fs.promises.rm(directory, { recursive: true, force: true }).catch(
                () => undefined
            );
        }
    }

    /**
     * Checks GitHub Releases for the latest update. In secure mode the signed
     * manifest is fetched and verified before `update-available` is emitted.
     */
    async checkForUpdates(options: UpdateOptions = {}): Promise<UpdateInfo | null> {
        const context = createAbortContext(this.effectiveOptions(options));
        try {
            if (context.signal?.aborted) {
                throw abortErrorFromSignal(context.signal);
            }
            this.lastVerifiedManifest = null;
            this.lastVerifiedArtifact = null;
            this.lastDownloadedPath = null;
            this.emit("checking-for-update");
            this.config.logger.info("Checking for updates...");
            const info = await this.githubProvider!.getLatestRelease({
                signal: context.signal,
            });
            if (context.signal?.aborted) {
                throw abortErrorFromSignal(context.signal);
            }
            this.lastUpdateInfo = info;

            if (
                !info ||
                !semver.valid(info.version) ||
                !semver.valid(this.currentVersion) ||
                !semver.gt(info.version, this.currentVersion)
            ) {
                if (this.debug) this.sendDebugLog("[Updater:debug] No update available.");
                this.emit("update-not-available");
                this.config.logger.info("No update available.");
                return null;
            }

            if (this.config.security.requireManifestSignature) {
                this.lastVerifiedManifest = await this.fetchVerifiedManifest(
                    info,
                    context.signal
                );
                this.assertManifestFresh(this.lastVerifiedManifest.manifest);
            }

            if (context.signal?.aborted) {
                throw abortErrorFromSignal(context.signal);
            }
            if (this.debug) {
                this.sendDebugLog("[Updater:debug] Update available:", info.version);
            }
            this.emit("update-available", info);
            this.config.logger.info("Update available:", info.version);
            if (this.config.autoDownload) {
                const autoOptions: UpdateOptions | undefined =
                    options.signal || options.timeoutMs !== undefined
                        ? { signal: options.signal, timeoutMs: options.timeoutMs }
                        : undefined;
                void this.downloadUpdate(autoOptions).catch(() => undefined);
            }
            return info;
        } catch (err: unknown) {
            const error = toError(err);
            if (context.signal?.aborted || isAbortError(error) || isTimeoutError(error)) {
                const cancellation = context.signal?.aborted
                    ? abortErrorFromSignal(context.signal)
                    : error;
                if (isTimeoutError(cancellation)) {
                    this.emit("error", cancellation);
                    this.config.logger.error("Update check timed out:", cancellation);
                }
                throw cancellation;
            }
            if (error instanceof UpdateSecurityError) {
                this.emit("error", error);
                this.config.logger.error("Update security check failed:", error);
                throw error;
            }
            if (this.debug) this.sendDebugLog("[Updater:debug] Error in checkForUpdates:", error);
            this.emit("error", error);
            this.config.logger.error("Update check failed:", error);
            return null;
        } finally {
            context.cleanup();
        }
    }

    private async downloadSecureUpdate(
        verified: VerifiedUpdateManifest,
        signal: AbortSignal | undefined
    ): Promise<VerifiedArtifact> {
        const security = this.config.security;
        const manifestAsset = verified.manifest.assets[0];
        const releaseAsset = this.findExactAsset(
            this.lastUpdateInfo!,
            manifestAsset.name,
            "MANIFEST_MISSING"
        );
        if (
            releaseAsset.size !== undefined &&
            releaseAsset.size !== manifestAsset.size
        ) {
            throw new UpdateSecurityError(
                "SIZE_MISMATCH",
                `Release asset size ${releaseAsset.size} does not match the signed size ${manifestAsset.size}`
            );
        }
        if (
            releaseAsset.sha256 &&
            releaseAsset.sha256.toLowerCase() !== manifestAsset.sha256
        ) {
            throw new UpdateSecurityError(
                "HASH_MISMATCH",
                "GitHub asset digest does not match the signed manifest hash"
            );
        }

        const directory = await fs.promises.mkdtemp(
            path.join(os.tmpdir(), "basic-electron-updater-")
        );
        try {
            await fs.promises.chmod(directory, 0o700).catch(() => undefined);
            const safeName = assertSafeAssetName(manifestAsset.name);
            const destination = path.join(directory, safeName);
            await this.downloader.downloadAsset(
                releaseAsset.url,
                destination,
                (progress) => {
                    if (this.debug) {
                        this.sendDebugLog("[Updater:debug] Download progress:", progress);
                    }
                    this.emit("download-progress", progress);
                },
                manifestAsset.sha256,
                { signal },
                this.downloadPolicy(security.maxDownloadBytes)
            );
            await this.verifyFile(
                destination,
                manifestAsset.size,
                manifestAsset.sha256,
                signal
            );
            return {
                path: destination,
                directory,
                size: manifestAsset.size,
                sha256: manifestAsset.sha256,
                manifest: verified.manifest,
            };
        } catch (error) {
            await fs.promises
                .rm(directory, { recursive: true, force: true })
                .catch(() => undefined);
            throw error;
        }
    }

    /**
     * Downloads the update asset for the current platform. Secure mode verifies
     * the signed manifest and the installer hash/size before emitting
     * `downloaded`; legacy mode requires an explicit security opt-in.
     */
    async downloadUpdate(options: UpdateOptions = {}): Promise<string> {
        if (!this.lastUpdateInfo) {
            throw new Error("No update info available. Call checkForUpdates() first.");
        }
        this.assertVersionIsNewer(this.lastUpdateInfo.version, "release");
        if (this.downloadInProgress) {
            throw new UpdateSecurityError(
                "CONCURRENT_UPDATE",
                "A download is already in progress"
            );
        }

        this.downloadInProgress = true;
        const context = createAbortContext(this.effectiveOptions(options));
        let downloadedPath: string | undefined;
        let stagingDirectory: string | undefined;
        let signaturePath: string | undefined;
        try {
            if (context.signal?.aborted) {
                throw abortErrorFromSignal(context.signal);
            }

            if (this.config.security.requireManifestSignature) {
                this.lastVerifiedArtifact = null;
                this.lastDownloadedPath = null;
                let manifest = this.lastVerifiedManifest;
                if (!manifest) {
                    manifest = await this.fetchVerifiedManifest(
                        this.lastUpdateInfo,
                        context.signal
                    );
                    this.lastVerifiedManifest = manifest;
                }
                this.assertManifestFresh(manifest.manifest);
                const artifact = await this.downloadSecureUpdate(
                    manifest,
                    context.signal
                );
                this.assertManifestFresh(manifest.manifest);
                stagingDirectory = artifact.directory;
                downloadedPath = artifact.path;
                if (context.signal?.aborted) {
                    throw abortErrorFromSignal(context.signal);
                }
                this.lastVerifiedArtifact = artifact;
                this.lastDownloadedPath = artifact.path;
                this.emit("downloaded", artifact.path);
                this.config.logger.info("Downloaded signed update to:", artifact.path);
                return artifact.path;
            }

            return await this.downloadLegacyUpdate(
                context.signal,
                (progress) => {
                    if (this.debug) {
                        this.sendDebugLog("[Updater:debug] Download progress:", progress);
                    }
                    this.emit("download-progress", progress);
                },
                (path) => {
                    downloadedPath = path;
                }
            );
        } catch (err: unknown) {
            const error = toError(err);
            if (context.signal?.aborted || isAbortError(error) || isTimeoutError(error)) {
                const cancellation = context.signal?.aborted
                    ? abortErrorFromSignal(context.signal)
                    : error;
                this.lastDownloadedPath = null;
                this.lastVerifiedArtifact = null;
                await this.discardDownload(downloadedPath, signaturePath, stagingDirectory);
                if (isTimeoutError(cancellation)) {
                    this.emit("error", cancellation);
                    this.config.logger.error("Download timed out:", cancellation);
                }
                throw cancellation;
            }
            this.lastDownloadedPath = null;
            this.lastVerifiedArtifact = null;
            await this.discardDownload(downloadedPath, signaturePath, stagingDirectory);
            if (this.debug) this.sendDebugLog("[Updater:debug] Download failed:", error);
            this.emit("error", error);
            this.config.logger.error("Download failed:", error);
            throw error;
        } finally {
            this.downloadInProgress = false;
            context.cleanup();
        }
    }

    private async downloadLegacyUpdate(
        signal: AbortSignal | undefined,
        onProgress: (progress: DownloadProgress) => void,
        onDownloadedPath: (filePath: string) => void
    ): Promise<string> {
        const platform = os.platform();
        const arch = os.arch();
        const asset = selectReleaseAsset(
            this.lastUpdateInfo!.assets,
            this.config.assetPolicy,
            { platform, arch }
        );
        if (this.config.security.requireSha256 && !asset.sha256) {
            throw new UpdateSecurityError(
                "HASH_REQUIRED",
                `Update asset ${asset.name} has no SHA256 digest; legacy mode requires one`
            );
        }

        const safeName = assertSafeAssetName(asset.name);
        const directory = await fs.promises.mkdtemp(
            path.join(os.tmpdir(), "basic-electron-updater-")
        );
        await fs.promises.chmod(directory, 0o700).catch(() => undefined);
        const destination = path.join(directory, safeName);

        try {
            const filePath = await this.downloader.downloadAsset(
                asset.url,
                destination,
                onProgress,
                asset.sha256,
                { signal },
                this.downloadPolicy(this.config.security.maxDownloadBytes)
            );
            onDownloadedPath(filePath);
            if (signal?.aborted) {
                throw abortErrorFromSignal(signal);
            }
            if (asset.gpgSignatureUrl && this.downloader.validateGpg) {
                const signaturePath = destination + ".sig";
                await this.downloader.downloadAsset(
                    asset.gpgSignatureUrl,
                    signaturePath,
                    undefined,
                    undefined,
                    { signal },
                    this.downloadPolicy(4096)
                );
                await this.downloader.validateGpg(
                    filePath,
                    signaturePath,
                    undefined,
                    { signal }
                );
            }
            if (signal?.aborted) {
                throw abortErrorFromSignal(signal);
            }
            this.lastDownloadedPath = filePath;
            this.lastVerifiedArtifact = null;
            this.emit("downloaded", filePath);
            this.config.logger.info("Downloaded update to:", filePath);
            return filePath;
        } catch (error) {
            await fs.promises
                .rm(directory, { recursive: true, force: true })
                .catch(() => undefined);
            throw error;
        }
    }

    private async verifyFile(
        filePath: string,
        expectedSize: number,
        expectedSha256: string,
        signal?: AbortSignal
    ): Promise<void> {
        const stat = await fs.promises.lstat(filePath);
        if (stat.isSymbolicLink() || !stat.isFile()) {
            throw new UpdateSecurityError(
                "UNSAFE_ASSET",
                "Downloaded update is not a regular file"
            );
        }
        if (stat.size !== expectedSize) {
            throw new UpdateSecurityError(
                "SIZE_MISMATCH",
                `Downloaded size ${stat.size} does not match ${expectedSize}`
            );
        }

        const hash = crypto.createHash("sha256");
        const stream = fs.createReadStream(filePath);
        try {
            for await (const chunk of stream) {
                if (signal?.aborted) {
                    stream.destroy();
                    throw abortErrorFromSignal(signal);
                }
                hash.update(chunk as Buffer);
            }
        } catch (error) {
            stream.destroy();
            throw toError(error);
        }

        const digest = hash.digest("hex");
        if (digest.toLowerCase() !== expectedSha256.toLowerCase()) {
            throw new UpdateSecurityError(
                "HASH_MISMATCH",
                `SHA256 mismatch: expected ${expectedSha256}, got ${digest}`
            );
        }
    }

    private async discardDownload(
        ...pathsOrDirectories: Array<string | undefined>
    ): Promise<void> {
        for (const entry of pathsOrDirectories) {
            if (!entry) continue;
            try {
                await fs.promises.rm(entry, { recursive: true, force: true });
            } catch {
                // Best effort; the original error is more useful.
            }
        }
    }

    private async defaultApply(
        installerPath: string,
        platform: string
    ): Promise<void> {
        if (platform === "win32") {
            await applyWindowsUpdate(installerPath);
        } else if (platform === "darwin") {
            await applyMacUpdate(installerPath);
        } else if (platform === "linux") {
            await applyLinuxUpdate(installerPath);
        } else {
            throw new Error("Unsupported platform: " + platform);
        }
    }

    /**
     * Applies the downloaded update only after the configured verification
     * stages succeed again. Installer arguments are never taken from metadata.
     */
    async applyUpdate(): Promise<void> {
        if (this.applyInProgress) {
            throw new UpdateSecurityError(
                "CONCURRENT_UPDATE",
                "An installer launch is already in progress"
            );
        }
        const artifact = this.lastVerifiedArtifact;
        const installerPath = artifact?.path ?? this.lastDownloadedPath;
        if (!installerPath) {
            throw new Error("No downloaded update to apply. Call downloadUpdate() first.");
        }
        if (this.lastUpdateInfo) {
            this.assertVersionIsNewer(this.lastUpdateInfo.version, "release");
        }
        if (artifact) {
            this.assertManifestFresh(artifact.manifest);
        }

        this.applyInProgress = true;
        try {
            const platform = os.platform();
            if (this.config.security.requireManifestSignature) {
                if (!artifact) {
                    throw new UpdateSecurityError(
                        "INVALID_SIGNATURE",
                        "No signed update artifact is available to apply"
                    );
                }
                if (!isPathInsideDirectory(installerPath, artifact.directory)) {
                    throw new UpdateSecurityError(
                        "UNSAFE_ASSET",
                        "Verified update is outside its private staging directory"
                    );
                }
                await this.verifyFile(
                    installerPath,
                    artifact.size,
                    artifact.sha256
                );
            }

            if (
                platform === "win32" &&
                this.config.security.authenticodeVerifier
            ) {
                try {
                    await this.config.security.authenticodeVerifier(
                        installerPath,
                        this.config.security.expectedWindowsPublisher
                    );
                } catch (error) {
                    throw new UpdateSecurityError(
                        "AUTHENTICODE_FAILED",
                        `Authenticode verification failed: ${
                            error instanceof Error ? error.message : String(error)
                        }`
                    );
                }
            }

            this.config.logger.info("Applying update for platform:", platform);
            await this.applyPlatform(installerPath, platform);
            if (this.config.security.requireManifestSignature) {
                this.lastDownloadedPath = null;
                this.lastVerifiedArtifact = null;
            }
            this.config.logger.info("Update applied (installer launched).");
        } catch (err: unknown) {
            const error = err instanceof Error ? err : new Error(String(err));
            if (this.debug) this.sendDebugLog("[Updater:debug] Failed to apply update:", error);
            this.emit("error", error);
            this.config.logger.error("Failed to apply update:", error);
            throw error;
        } finally {
            this.applyInProgress = false;
        }
    }
}
