import type { SecurityOptions, TrustedPublicKey } from "../types";
import { assertSafeAssetName } from "../utils/paths";
import {
    ParsedTrustedKey,
    parseTrustedPublicKeys,
} from "./keys";
import { SecurityConfigError } from "./errors";

export const DEFAULT_ALLOWED_DOWNLOAD_HOSTS: readonly string[] = [
    "github.com",
    "objects.githubusercontent.com",
    "release-assets.githubusercontent.com",
    "github-releases.githubusercontent.com",
];

export interface ResolvedSecurityOptions {
    publicKeys: TrustedPublicKey[];
    parsedPublicKeys: ParsedTrustedKey[];
    requireManifestSignature: boolean;
    allowUnsignedUpdates: boolean;
    requireSha256: boolean;
    manifestAssetName: string;
    manifestSignatureAssetName: string;
    appId: string;
    allowedDownloadHosts: string[];
    maxDownloadBytes: number;
    maxManifestBytes: number;
    requestTimeoutMs: number;
    operationTimeoutMs: number;
    authenticodeVerifier?: (
        installerPath: string,
        expectedPublisher?: string
    ) => Promise<void>;
    expectedWindowsPublisher?: string;
    requireAuthenticode: boolean;
}

function positiveInteger(value: number | undefined, fallback: number, label: string): number {
    const resolved = value ?? fallback;
    if (!Number.isSafeInteger(resolved) || resolved <= 0) {
        throw new SecurityConfigError(
            "INSECURE_CONFIG",
            `${label} must be a positive integer`
        );
    }
    return resolved;
}

function normalizeHosts(hosts: string[] | undefined): string[] {
    const values = hosts ?? [...DEFAULT_ALLOWED_DOWNLOAD_HOSTS];
    if (!Array.isArray(values) || values.length === 0) {
        throw new SecurityConfigError(
            "INSECURE_CONFIG",
            "allowedDownloadHosts must contain at least one hostname"
        );
    }
    return values.map((host) => {
        if (typeof host !== "string") {
            throw new SecurityConfigError(
                "INSECURE_CONFIG",
                "allowedDownloadHosts entries must be strings"
            );
        }
        const normalized = host.trim().toLowerCase();
        if (
            !normalized ||
            normalized.includes("/") ||
            normalized.includes(":") ||
            normalized.startsWith(".") ||
            /\s/.test(normalized)
        ) {
            throw new SecurityConfigError(
                "INSECURE_CONFIG",
                `Invalid download host: ${host}`
            );
        }
        return normalized;
    });
}

/**
 * Resolves secure defaults and validates the security policy at Updater
 * construction time. This is intentionally fail-closed: absence of pinned keys
 * is an error unless the caller explicitly opts into unsigned updates.
 */
export function resolveSecurityOptions(
    options: SecurityOptions | undefined,
    repo: string
): ResolvedSecurityOptions {
    const allowUnsignedUpdates = options?.allowUnsignedUpdates === true;
    const requireManifestSignature =
        options?.requireManifestSignature ?? true;
    const requireSha256 = options?.requireSha256 ?? true;

    if (allowUnsignedUpdates && requireManifestSignature) {
        throw new SecurityConfigError(
            "INSECURE_CONFIG",
            "allowUnsignedUpdates requires requireManifestSignature: false"
        );
    }
    if (!allowUnsignedUpdates && !requireManifestSignature) {
        throw new SecurityConfigError(
            "INSECURE_CONFIG",
            "Unsigned updates require allowUnsignedUpdates: true"
        );
    }
    if (!allowUnsignedUpdates && requireSha256 !== true) {
        throw new SecurityConfigError(
            "INSECURE_CONFIG",
            "requireSha256 may only be disabled for explicit legacy updates"
        );
    }

    const publicKeys = options?.publicKeys ?? [];
    if (!allowUnsignedUpdates && publicKeys.length === 0) {
        throw new SecurityConfigError(
            "INSECURE_CONFIG",
            "publicKeys is required for signed updates; use allowUnsignedUpdates: true only for an explicit legacy mode"
        );
    }

    const parsedPublicKeys =
        publicKeys.length > 0 ? parseTrustedPublicKeys(publicKeys) : [];

    const manifestAssetName =
        options?.manifestAssetName ?? "update-manifest.json";
    const manifestSignatureAssetName =
        options?.manifestSignatureAssetName ?? "update-manifest.json.sig";
    try {
        assertSafeAssetName(manifestAssetName);
        assertSafeAssetName(manifestSignatureAssetName);
    } catch (error) {
        throw new SecurityConfigError(
            "INSECURE_CONFIG",
            `Invalid manifest asset name: ${(error as Error).message}`
        );
    }
    if (manifestAssetName === manifestSignatureAssetName) {
        throw new SecurityConfigError(
            "INSECURE_CONFIG",
            "Manifest and signature asset names must differ"
        );
    }

    const appId = options?.appId ?? repo;
    if (typeof appId !== "string" || appId.trim().length === 0) {
        throw new SecurityConfigError(
            "INSECURE_CONFIG",
            "appId must be a non-empty string"
        );
    }

    const maxDownloadBytes = positiveInteger(
        options?.maxDownloadBytes,
        512 * 1024 * 1024,
        "maxDownloadBytes"
    );
    const maxManifestBytes = positiveInteger(
        options?.maxManifestBytes,
        64 * 1024,
        "maxManifestBytes"
    );
    if (maxManifestBytes > maxDownloadBytes) {
        throw new SecurityConfigError(
            "INSECURE_CONFIG",
            "maxManifestBytes must not exceed maxDownloadBytes"
        );
    }

    const requireAuthenticode = options?.requireAuthenticode === true;
    if (
        options?.authenticodeVerifier !== undefined &&
        typeof options.authenticodeVerifier !== "function"
    ) {
        throw new SecurityConfigError(
            "INSECURE_CONFIG",
            "authenticodeVerifier must be a function"
        );
    }
    if (
        options?.expectedWindowsPublisher !== undefined &&
        typeof options.expectedWindowsPublisher !== "string"
    ) {
        throw new SecurityConfigError(
            "INSECURE_CONFIG",
            "expectedWindowsPublisher must be a string"
        );
    }
    if (
        requireAuthenticode &&
        typeof options?.authenticodeVerifier !== "function"
    ) {
        throw new SecurityConfigError(
            "AUTHENTICODE_REQUIRED",
            "requireAuthenticode requires an authenticodeVerifier callback; this package does not implement Authenticode itself"
        );
    }

    return {
        publicKeys,
        parsedPublicKeys,
        requireManifestSignature,
        allowUnsignedUpdates,
        requireSha256,
        manifestAssetName,
        manifestSignatureAssetName,
        appId: appId.trim(),
        allowedDownloadHosts: normalizeHosts(options?.allowedDownloadHosts),
        maxDownloadBytes,
        maxManifestBytes,
        requestTimeoutMs: positiveInteger(
            options?.requestTimeoutMs,
            30_000,
            "requestTimeoutMs"
        ),
        operationTimeoutMs: positiveInteger(
            options?.operationTimeoutMs,
            5 * 60_000,
            "operationTimeoutMs"
        ),
        authenticodeVerifier: options?.authenticodeVerifier,
        expectedWindowsPublisher: options?.expectedWindowsPublisher,
        requireAuthenticode,
    };
}
