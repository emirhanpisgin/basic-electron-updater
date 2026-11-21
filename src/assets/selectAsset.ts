import type { AssetArch, AssetPlatform, AssetPolicy } from "../types";
import { isSafeAssetName } from "../utils/paths";

export type AssetSelectionErrorCode =
    | "INVALID_POLICY"
    | "UNSUPPORTED_PLATFORM"
    | "UNSUPPORTED_ARCH"
    | "POLICY_MISMATCH"
    | "NO_MATCH"
    | "AMBIGUOUS";

/**
 * Thrown before a download starts when the release does not contain exactly
 * one asset that satisfies the configured contract.
 */
export class AssetSelectionError extends Error {
    readonly code: AssetSelectionErrorCode;
    /** Asset names involved in the failure, sorted for stable reporting. */
    readonly assets: readonly string[];

    constructor(
        code: AssetSelectionErrorCode,
        message: string,
        assets: readonly string[] = []
    ) {
        super(message);
        this.name = "AssetSelectionError";
        this.code = code;
        this.assets = [...assets];
    }
}

export interface ResolvedAssetPolicy extends AssetPolicy {
    product: string;
}

const PLATFORM_VALUES: readonly AssetPlatform[] = [
    "win32",
    "darwin",
    "linux",
];

const PLATFORM_ALIASES: Record<AssetPlatform, readonly string[]> = {
    win32: ["win32", "win", "windows"],
    darwin: ["darwin", "mac", "macos", "osx"],
    linux: ["linux"],
};

const ARCH_ALIASES: Record<AssetArch, readonly string[]> = {
    x64: ["x64", "amd64"],
    ia32: ["ia32", "x86", "i386", "i686"],
    arm64: ["arm64"],
    arm: ["arm", "armv7", "armv7l"],
};

const EXTENSIONS: Record<AssetPlatform, readonly string[]> = {
    win32: [".exe", ".msi", ".nsis.zip"],
    darwin: [".dmg", ".pkg", ".zip"],
    linux: [".appimage", ".tar.gz", ".deb", ".rpm", ".snap"],
};

const SORTED_EXTENSIONS: Record<AssetPlatform, readonly string[]> = {
    win32: [...EXTENSIONS.win32].sort((a, b) => b.length - a.length),
    darwin: [...EXTENSIONS.darwin].sort((a, b) => b.length - a.length),
    linux: [...EXTENSIONS.linux].sort((a, b) => b.length - a.length),
};

const PLATFORM_TOKENS: Record<string, AssetPlatform> = {};
for (const platform of PLATFORM_VALUES) {
    for (const alias of PLATFORM_ALIASES[platform]) {
        PLATFORM_TOKENS[alias] = platform;
    }
}

const ARCH_TOKENS: Record<string, AssetArch> = {};
for (const arch of Object.keys(ARCH_ALIASES) as AssetArch[]) {
    for (const alias of ARCH_ALIASES[arch]) {
        ARCH_TOKENS[alias] = arch;
    }
}

function isAssetPlatform(value: unknown): value is AssetPlatform {
    return (
        typeof value === "string" &&
        Object.prototype.hasOwnProperty.call(PLATFORM_ALIASES, value)
    );
}

function isAssetArch(value: unknown): value is AssetArch {
    return (
        typeof value === "string" &&
        Object.prototype.hasOwnProperty.call(ARCH_ALIASES, value)
    );
}

function unique<T>(values: readonly T[]): T[] {
    return [...new Set(values)];
}

function matchExtension(
    name: string,
    extensions: readonly string[]
): string | undefined {
    const lower = name.toLowerCase();
    return extensions.find((extension) => lower.endsWith(extension));
}

/** True when `name` has a supported installer extension for `platform`. */
export function isSupportedInstallerName(
    name: string,
    platform: string
): boolean {
    return (
        isAssetPlatform(platform) &&
        isSafeAssetName(name) &&
        !!matchExtension(name, SORTED_EXTENSIONS[platform])
    );
}

function platformForExtension(name: string): AssetPlatform | undefined {
    const lower = name.toLowerCase();
    let best: { platform: AssetPlatform; length: number } | undefined;
    for (const platform of PLATFORM_VALUES) {
        for (const extension of SORTED_EXTENSIONS[platform]) {
            if (
                lower.endsWith(extension) &&
                (!best || extension.length > best.length)
            ) {
                best = { platform, length: extension.length };
            }
        }
    }
    return best?.platform;
}

function unsupportedExtensionReason(
    name: string,
    platform: AssetPlatform
): string {
    const tokens = tokenize(name);
    const tokenPlatforms = unique(
        tokens
            .map(platformForToken)
            .filter((value): value is AssetPlatform => !!value)
    );
    if (tokenPlatforms.includes(platform)) {
        return `${name} (unsupported installer format for ${platform}; expected ${EXTENSIONS[
            platform
        ].join(", ")})`;
    }
    if (tokenPlatforms.length === 1) {
        return `${name} (wrong platform: ${tokenPlatforms[0]})`;
    }
    const owner = platformForExtension(name);
    if (owner && owner !== platform) {
        return `${name} (wrong platform: ${owner})`;
    }
    return `${name} (unsupported installer format for ${platform}; expected ${EXTENSIONS[
        platform
    ].join(", ")})`;
}

function matchesProduct(stem: string, productLower: string): boolean {
    const stemLower = stem.toLowerCase();
    if (stemLower === productLower) return true;
    if (!stemLower.startsWith(productLower)) return false;
    const boundary = stemLower.charAt(productLower.length);
    return (
        boundary === "." ||
        boundary === "-" ||
        boundary === "_" ||
        boundary === " "
    );
}

function tokenize(value: string): string[] {
    return value
        .toLowerCase()
        .replace(/x86[_-]64/g, "x64")
        .replace(/aarch64/g, "arm64")
        .split(/[^a-z0-9]+/)
        .filter(Boolean);
}

function platformForToken(token: string): AssetPlatform | undefined {
    return PLATFORM_TOKENS[token];
}

function archForToken(token: string): AssetArch | undefined {
    return ARCH_TOKENS[token];
}

function policyError(message: string): AssetSelectionError {
    return new AssetSelectionError("INVALID_POLICY", message);
}

/**
 * Fills the product default and validates the user-supplied policy early, at
 * Updater construction time.
 */
export function normalizeAssetPolicy(
    policy: AssetPolicy | undefined,
    defaultProduct: string
): ResolvedAssetPolicy {
    if (policy?.product !== undefined && typeof policy.product !== "string") {
        throw policyError("assetPolicy.product must be a string");
    }
    const product = (policy?.product ?? defaultProduct).trim();
    if (!product || /[\\/]/.test(product)) {
        throw policyError(
            "assetPolicy.product must be a non-empty product name without path separators"
        );
    }

    if (policy?.platform !== undefined && !isAssetPlatform(policy.platform)) {
        throw policyError(
            `Unsupported assetPolicy.platform: ${String(policy.platform)}`
        );
    }
    if (policy?.arch !== undefined && !isAssetArch(policy.arch)) {
        throw policyError(`Unsupported assetPolicy.arch: ${String(policy.arch)}`);
    }

    let legacyAssetName = policy?.legacyAssetName;
    if (
        legacyAssetName !== undefined &&
        legacyAssetName !== null &&
        typeof legacyAssetName !== "string"
    ) {
        throw policyError("assetPolicy.legacyAssetName must be a string or null");
    }
    if (legacyAssetName !== undefined && legacyAssetName !== null) {
        legacyAssetName = legacyAssetName.trim();
        if (!legacyAssetName || /[\\/]/.test(legacyAssetName)) {
            throw policyError(
                "assetPolicy.legacyAssetName must be a non-empty asset name without path separators"
            );
        }
    }

    return {
        product,
        platform: policy?.platform,
        arch: policy?.arch,
        legacyAssetName,
    };
}

/**
 * Pure selector for exactly one release asset. It never falls back to the
 * first broad extension/name match and performs no I/O.
 */
export function selectReleaseAsset<T extends { name: string }>(
    assets: readonly T[],
    policy: AssetPolicy,
    runtime: { platform: string; arch: string }
): T {
    const product =
        typeof policy?.product === "string" ? policy.product.trim() : "";
    if (!product || /[\\/]/.test(product)) {
        throw policyError(
            "Asset policy requires a non-empty product name without path separators"
        );
    }

    const platform = runtime.platform;
    if (!isAssetPlatform(platform)) {
        throw new AssetSelectionError(
            "UNSUPPORTED_PLATFORM",
            `Unsupported update platform: ${platform}`
        );
    }
    const arch = runtime.arch;
    if (!isAssetArch(arch)) {
        throw new AssetSelectionError(
            "UNSUPPORTED_ARCH",
            `Unsupported update architecture: ${arch}`
        );
    }

    if (policy.platform !== undefined && policy.platform !== platform) {
        throw new AssetSelectionError(
            "POLICY_MISMATCH",
            `Asset policy targets ${policy.platform} but this runtime is ${platform}`
        );
    }
    if (policy.arch !== undefined && policy.arch !== arch) {
        throw new AssetSelectionError(
            "POLICY_MISMATCH",
            `Asset policy targets ${policy.arch} but this runtime is ${arch}`
        );
    }

    const productLower = product.toLowerCase();
    const legacyName =
        policy.legacyAssetName === undefined
            ? platform === "win32"
                ? `${product}.Setup.exe`
                : null
            : policy.legacyAssetName;
    const legacyLower = legacyName?.toLowerCase() ?? null;

    const explicit: T[] = [];
    const legacy: T[] = [];
    const missingArch: string[] = [];
    const malformedArch: string[] = [];
    const wrongArch: string[] = [];
    const samePlatformAssets: string[] = [];
    const rejected: string[] = [];

    for (const asset of assets) {
        const name = asset.name;
        if (!isSafeAssetName(name)) {
            rejected.push(`${name} (unsafe asset name)`);
            continue;
        }
        const hostExtension = matchExtension(
            name,
            SORTED_EXTENSIONS[platform]
        );

        if (!hostExtension) {
            if (!name) {
                rejected.push("empty asset name");
            } else {
                rejected.push(unsupportedExtensionReason(name, platform));
            }
            continue;
        }

        const stem = name.slice(0, name.length - hostExtension.length);
        if (!matchesProduct(stem, productLower)) {
            rejected.push(`${name} (wrong product)`);
            continue;
        }

        const rest = stem
            .slice(productLower.length)
            .replace(/^[.\-_\s]+/, "");
        const tokens = tokenize(rest);

        const platformTokens = unique(
            tokens
                .map(platformForToken)
                .filter((value): value is AssetPlatform => !!value)
        );
        if (platformTokens.length > 1) {
            rejected.push(
                `${name} (mixed platform tokens: ${platformTokens.join(", ")})`
            );
            continue;
        }
        if (platformTokens.length === 1 && platformTokens[0] !== platform) {
            rejected.push(`${name} (wrong platform: ${platformTokens[0]})`);
            continue;
        }

        // From here the asset belongs to the requested product and platform.
        samePlatformAssets.push(name);

        const archTokens = unique(
            tokens
                .map(archForToken)
                .filter((value): value is AssetArch => !!value)
        );
        if (archTokens.length > 1) {
            malformedArch.push(name);
            rejected.push(
                `${name} (mixed architecture tokens: ${archTokens.join(", ")})`
            );
            continue;
        }
        if (archTokens.length === 1) {
            if (archTokens[0] !== arch) {
                wrongArch.push(name);
                rejected.push(
                    `${name} (wrong architecture: ${archTokens[0]})`
                );
                continue;
            }
            explicit.push(asset);
            continue;
        }

        if (legacyLower !== null && name.toLowerCase() === legacyLower) {
            legacy.push(asset);
            continue;
        }

        missingArch.push(name);
        rejected.push(`${name} (missing architecture token)`);
    }

    const ambiguous = (names: readonly string[]): AssetSelectionError => {
        const sorted = unique(names).sort();
        return new AssetSelectionError(
            "AMBIGUOUS",
            `Ambiguous update asset for ${product} on ${platform}/${arch}: ${sorted.join(
                ", "
            )}. Publish exactly one matching asset.`,
            sorted
        );
    };

    if (explicit.length > 1) {
        throw ambiguous([
            ...explicit.map((asset) => asset.name),
            ...legacy.map((asset) => asset.name),
        ]);
    }

    if (explicit.length === 1) {
        const blockers = [
            ...legacy.map((asset) => asset.name),
            ...missingArch,
            ...malformedArch,
        ];
        if (blockers.length > 0) {
            throw ambiguous([explicit[0].name, ...blockers]);
        }
        return explicit[0];
    }

    if (legacy.length > 1) {
        throw ambiguous(legacy.map((asset) => asset.name));
    }

    if (legacy.length === 1) {
        const others = samePlatformAssets.filter(
            (name) => name.toLowerCase() !== legacyLower
        );
        if (others.length > 0) {
            throw ambiguous([legacy[0].name, ...others]);
        }
        return legacy[0];
    }

    const detail =
        rejected.length > 0
            ? ` Rejected: ${rejected.join("; ")}.`
            : " The release has no assets.";
    throw new AssetSelectionError(
        "NO_MATCH",
        `No update asset matches ${product} for ${platform}/${arch}.${detail}`,
        assets.map((asset) => asset.name)
    );
}
