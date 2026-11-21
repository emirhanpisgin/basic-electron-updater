import * as semver from "semver";
import type { AssetArch, AssetPlatform } from "../types";
import { isSupportedInstallerName } from "../assets/selectAsset";
import { assertSafeAssetName } from "../utils/paths";
import { UpdateSecurityError } from "./errors";
import {
    ParsedTrustedKey,
    verifyDetachedSignature,
} from "./keys";

export interface ManifestAsset {
    name: string;
    size: number;
    /** Lowercase or uppercase 64-character SHA-256 hex digest. */
    sha256: string;
}

/**
 * The exact object covered by the detached Ed25519 signature. The signature is
 * over the raw UTF-8 bytes of the manifest file, not a re-serialized JSON
 * value.
 */
export interface SignedUpdateManifest {
    schemaVersion: 1;
    keyId: string;
    appId: string;
    version: string;
    platform: AssetPlatform;
    architecture: AssetArch;
    channel: string;
    publishedAt: string;
    expiresAt: string;
    assets: ManifestAsset[];
}

export interface ManifestExpectations {
    appId: string;
    version: string;
    platform: string;
    architecture: string;
    channel: string;
    maxAssetBytes: number;
    now?: number;
}

export interface VerifiedUpdateManifest {
    manifest: SignedUpdateManifest;
    bytes: Buffer;
    keyId: string;
}

const ALLOWED_TOP_LEVEL = new Set([
    "schemaVersion",
    "keyId",
    "appId",
    "version",
    "platform",
    "architecture",
    "channel",
    "publishedAt",
    "expiresAt",
    "assets",
]);

const ALLOWED_ASSET = new Set(["name", "size", "sha256"]);
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const SHA256_HEX = /^[0-9a-f]{64}$/i;
const CLOCK_SKEW_MS = 5 * 60_000;

function invalid(message: string): never {
    throw new UpdateSecurityError("INVALID_MANIFEST", message);
}

function asObject(value: unknown, label: string): Record<string, unknown> {
    if (
        value === null ||
        typeof value !== "object" ||
        Array.isArray(value)
    ) {
        invalid(`${label} must be an object`);
    }
    const object = value as Record<string, unknown>;
    for (const key of Object.keys(object)) {
        if (!ALLOWED_TOP_LEVEL.has(key) && label === "manifest") {
            invalid(`Unknown manifest field: ${key}`);
        }
    }
    return object;
}

function requireString(
    object: Record<string, unknown>,
    key: string,
    label: string,
    maxLength = 512
): string {
    const value = object[key];
    if (typeof value !== "string" || value.length === 0) {
        invalid(`${label}.${key} must be a non-empty string`);
    }
    if (value.length > maxLength) {
        invalid(`${label}.${key} is too long`);
    }
    return value;
}

function requireIsoDate(
    object: Record<string, unknown>,
    key: string,
    label: string
): { value: string; time: number } {
    const value = requireString(object, key, label, 64);
    if (!ISO_UTC.test(value)) {
        invalid(`${label}.${key} must be an ISO-8601 UTC timestamp`);
    }
    const time = Date.parse(value);
    if (!Number.isFinite(time)) {
        invalid(`${label}.${key} is not a valid timestamp`);
    }
    return { value, time };
}

function validateAsset(
    raw: unknown,
    platform: AssetPlatform,
    maxAssetBytes: number
): ManifestAsset {
    if (
        raw === null ||
        typeof raw !== "object" ||
        Array.isArray(raw)
    ) {
        invalid("manifest.assets entries must be objects");
    }
    const asset = raw as Record<string, unknown>;
    for (const key of Object.keys(asset)) {
        if (!ALLOWED_ASSET.has(key)) {
            invalid(`Unknown manifest asset field: ${key}`);
        }
    }

    const rawName = requireString(asset, "name", "manifest.assets[]", 255);
    let name: string;
    try {
        name = assertSafeAssetName(rawName);
    } catch (error) {
        throw new UpdateSecurityError(
            "UNSAFE_ASSET",
            `Unsafe manifest asset name: ${(error as Error).message}`
        );
    }
    if (!isSupportedInstallerName(name, platform)) {
        invalid(`Manifest asset is not a supported ${platform} installer: ${name}`);
    }

    const size = asset.size;
    if (
        typeof size !== "number" ||
        !Number.isSafeInteger(size) ||
        size <= 0 ||
        size > maxAssetBytes
    ) {
        invalid(`Manifest asset size must be an integer between 1 and ${maxAssetBytes}`);
    }

    const sha256 = requireString(asset, "sha256", "manifest.assets[]", 64);
    if (!SHA256_HEX.test(sha256)) {
        invalid("Manifest asset sha256 must be 64 hexadecimal characters");
    }

    return { name, size, sha256: sha256.toLowerCase() };
}

function validateManifest(
    raw: unknown,
    expected: ManifestExpectations,
    now: number
): SignedUpdateManifest {
    const manifest = asObject(raw, "manifest");

    if (manifest.schemaVersion !== 1) {
        invalid("Unsupported manifest schemaVersion; expected 1");
    }

    const keyId = requireString(manifest, "keyId", "manifest", 128);
    const appId = requireString(manifest, "appId", "manifest", 256);
    const version = requireString(manifest, "version", "manifest", 64);
    const platform = requireString(manifest, "platform", "manifest", 16);
    const architecture = requireString(
        manifest,
        "architecture",
        "manifest",
        16
    );
    const channel = requireString(manifest, "channel", "manifest", 64);
    const publishedAt = requireIsoDate(manifest, "publishedAt", "manifest");
    const expiresAt = requireIsoDate(manifest, "expiresAt", "manifest");

    if (appId !== expected.appId) {
        throw new UpdateSecurityError(
            "WRONG_APP",
            `Manifest appId ${appId} does not match ${expected.appId}`
        );
    }

    const expectedVersion = semver.clean(expected.version);
    const manifestVersion = semver.clean(version);
    if (!expectedVersion || !manifestVersion) {
        throw new UpdateSecurityError(
            "WRONG_VERSION",
            `Manifest and release versions must be valid semantic versions (got ${version})`
        );
    }
    if (manifestVersion !== expectedVersion) {
        throw new UpdateSecurityError(
            "WRONG_VERSION",
            `Manifest version ${version} does not match release version ${expected.version}`
        );
    }

    if (platform !== expected.platform) {
        throw new UpdateSecurityError(
            "WRONG_PLATFORM",
            `Manifest platform ${platform} does not match runtime ${expected.platform}`
        );
    }
    if (architecture !== expected.architecture) {
        throw new UpdateSecurityError(
            "WRONG_ARCHITECTURE",
            `Manifest architecture ${architecture} does not match runtime ${expected.architecture}`
        );
    }
    if (channel !== expected.channel) {
        throw new UpdateSecurityError(
            "WRONG_CHANNEL",
            `Manifest channel ${channel} does not match configured channel ${expected.channel}`
        );
    }

    if (publishedAt.time > now + CLOCK_SKEW_MS) {
        invalid("Manifest publishedAt is in the future");
    }
    if (expiresAt.time <= now) {
        throw new UpdateSecurityError(
            "EXPIRED_MANIFEST",
            `Manifest expired at ${expiresAt.value}`
        );
    }
    if (expiresAt.time <= publishedAt.time) {
        invalid("Manifest expiresAt must be after publishedAt");
    }

    if (!Array.isArray(manifest.assets) || manifest.assets.length !== 1) {
        invalid("Manifest must contain exactly one asset for this platform");
    }
    const asset = validateAsset(
        manifest.assets[0],
        platform as AssetPlatform,
        expected.maxAssetBytes
    );

    return {
        schemaVersion: 1,
        keyId,
        appId,
        version: manifestVersion,
        platform: platform as AssetPlatform,
        architecture: architecture as AssetArch,
        channel,
        publishedAt: publishedAt.value,
        expiresAt: expiresAt.value,
        assets: [asset],
    };
}

/**
 * Verifies the detached signature over the exact manifest bytes, then validates
 * every field. The signature is checked before any manifest field is trusted
 * except the `keyId` lookup hint, which must identify a pinned key.
 */
export function verifySignedManifest(
    manifestBytes: Buffer,
    signatureBase64: string,
    keys: readonly ParsedTrustedKey[],
    expected: ManifestExpectations
): VerifiedUpdateManifest {
    if (!Buffer.isBuffer(manifestBytes) || manifestBytes.length === 0) {
        throw new UpdateSecurityError(
            "MANIFEST_MISSING",
            "Manifest bytes are missing"
        );
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(manifestBytes.toString("utf8"));
    } catch {
        throw new UpdateSecurityError(
            "INVALID_MANIFEST",
            "Manifest is not valid JSON"
        );
    }
    const object = asObject(parsed, "manifest");
    const keyId = requireString(object, "keyId", "manifest", 128);

    const match = verifyDetachedSignature(
        manifestBytes,
        signatureBase64,
        keys,
        keyId
    );
    const now = expected.now ?? Date.now();
    const manifest = validateManifest(object, expected, now);

    return {
        manifest,
        bytes: Buffer.from(manifestBytes),
        keyId: match.keyId,
    };
}
