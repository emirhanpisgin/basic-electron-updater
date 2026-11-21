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
    /**
     * Explicit release asset contract.
     *
     * When omitted, `product` defaults to the repository name and the only
     * arch-less name accepted on Windows is `<product>.Setup.exe`.
     */
    assetPolicy?: AssetPolicy;
    /**
     * Update-security configuration. Secure signature verification is the
     * default; unsigned downloads require an explicit opt-in.
     */
    security?: SecurityOptions;
    // Add more config options as needed
}

/** A public key pinned by the application for signed update manifests. */
export interface TrustedPublicKey {
    /** Stable identifier included in the signed manifest. */
    keyId: string;
    /** Base64 SPKI DER or PEM-encoded Ed25519 public key. */
    publicKey: string;
}

/**
 * Security policy for update discovery, download and installation.
 *
 * The default is secure: signed manifests are required, SHA-256 is required,
 * and unsigned updates are rejected. Legacy unsigned behavior is available
 * only with `allowUnsignedUpdates: true`.
 */
export interface SecurityOptions {
    /** Pinned Ed25519 public keys. Required in secure mode. */
    publicKeys?: TrustedPublicKey[];
    /**
     * Require a signed manifest. Defaults to true. Setting false is rejected
     * unless `allowUnsignedUpdates` is also true.
     */
    requireManifestSignature?: boolean;
    /**
     * Explicit legacy opt-in for unsigned downloads. Defaults to false and
     * emits a startup warning. Never silently disables validation.
     */
    allowUnsignedUpdates?: boolean;
    /**
     * Require SHA-256 for executable downloads. Defaults to true and may only
     * be disabled with `allowUnsignedUpdates: true`.
     */
    requireSha256?: boolean;
    /** Exact release-asset name of the signed manifest. */
    manifestAssetName?: string;
    /** Exact release-asset name of the detached manifest signature. */
    manifestSignatureAssetName?: string;
    /** Application identity bound in the manifest. Defaults to repo. */
    appId?: string;
    /** HTTPS hosts allowed for manifest and installer downloads. */
    allowedDownloadHosts?: string[];
    /** Maximum installer bytes. Defaults to 512 MiB. */
    maxDownloadBytes?: number;
    /** Maximum signed-manifest bytes. Defaults to 64 KiB. */
    maxManifestBytes?: number;
    /** Per-request/inactivity timeout. Defaults to 30 seconds. */
    requestTimeoutMs?: number;
    /** Default total operation timeout when the caller supplies none. */
    operationTimeoutMs?: number;
    /**
     * Optional host-supplied Authenticode verifier. The library does not ship
     * a built-in Windows Authenticode implementation; when configured this
     * hook must throw for an unsigned or unexpected publisher.
     */
    authenticodeVerifier?: (
        installerPath: string,
        expectedPublisher?: string
    ) => Promise<void>;
    /** Publisher identity passed to `authenticodeVerifier`. */
    expectedWindowsPublisher?: string;
    /** Require `authenticodeVerifier` to succeed before Windows installation. */
    requireAuthenticode?: boolean;
}

/** Platforms with a defined release-asset naming contract. */
export type AssetPlatform = "win32" | "darwin" | "linux";

/** Architectures with a defined release-asset naming contract. */
export type AssetArch = "x64" | "ia32" | "arm64" | "arm";

/**
 * Release asset naming contract.
 *
 * A matching asset must start with `product`, use a supported installer
 * extension for the runtime platform and carry the runtime architecture as a
 * name token (for example `Melodify-1.0.7-win32-x64.exe`). An exact legacy
 * name without an architecture token is accepted only when no other
 * architecture-specific asset for the same platform is present.
 */
export interface AssetPolicy {
    /** Product identity token at the start of the asset name. */
    product?: string;
    /** Expected platform; defaults to and must match the runtime platform. */
    platform?: AssetPlatform;
    /** Expected architecture; defaults to and must match the runtime architecture. */
    arch?: AssetArch;
    /**
     * Exact legacy installer name accepted for this platform.
     * Defaults to `<product>.Setup.exe` on Windows; `null` disables legacy
     * matching. Other platforms accept no legacy name by default.
     */
    legacyAssetName?: string | null;
}

/**
 * Options shared by update operations.
 *
 * - `signal`: cancels the operation. A caller abort rejects with an Error named
 *   `AbortError`; the updater never emits `downloaded` or stores the path.
 * - `timeoutMs`: bounds the whole operation. Expiry rejects with an Error named
 *   `TimeoutError` and also emits `error`.
 *
 * Both options are optional. Omitting them preserves the existing
 * non-cancellable behavior.
 */
export interface UpdateOptions {
    /** Cancels fetches, downloads and in-flight stream writes. */
    signal?: AbortSignal;
    /** Positive, finite timeout in milliseconds for the whole operation. */
    timeoutMs?: number;
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
        /** Asset size reported by the release API, when available. */
        size?: number;
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
    /** Emitted when checking for updates starts */
    "checking-for-update": () => void;
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
    info(message: string, ...args: unknown[]): void;
    warn(message: string, ...args: unknown[]): void;
    error(message: string, ...args: unknown[]): void;
    debug?(message: string, ...args: unknown[]): void;
}
