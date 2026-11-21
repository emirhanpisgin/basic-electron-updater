import * as crypto from "crypto";
import type {
    ManifestAsset,
    SignedUpdateManifest,
} from "../../src/security/manifest";

export interface TestKey {
    keyId: string;
    privateKey: crypto.KeyObject;
    publicKey: crypto.KeyObject;
    publicKeyBase64: string;
}

export function generateTestKey(keyId = "test-key"): TestKey {
    const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
    return {
        keyId,
        privateKey,
        publicKey,
        publicKeyBase64: publicKey
            .export({ format: "der", type: "spki" })
            .toString("base64"),
    };
}

export function sha256(bytes: Buffer): string {
    return crypto.createHash("sha256").update(bytes).digest("hex");
}

export interface ManifestOptions {
    keyId?: string;
    appId?: string;
    version?: string;
    platform?: "win32" | "darwin" | "linux";
    architecture?: "x64" | "ia32" | "arm64" | "arm";
    channel?: string;
    publishedAt?: string;
    expiresAt?: string;
    assets?: ManifestAsset[];
}

export function makeManifest(
    installerBytes: Buffer,
    options: ManifestOptions = {}
): SignedUpdateManifest {
    const now = Date.now();
    const asset: ManifestAsset = {
        name: "Melodify-1.2.0-win32-x64.exe",
        size: installerBytes.length,
        sha256: sha256(installerBytes),
    };
    return {
        schemaVersion: 1,
        keyId: options.keyId ?? "test-key",
        appId: options.appId ?? "owner/repo",
        version: options.version ?? "v1.2.0",
        platform: options.platform ?? "win32",
        architecture: options.architecture ?? "x64",
        channel: options.channel ?? "latest",
        publishedAt:
            options.publishedAt ?? new Date(now - 60_000).toISOString(),
        expiresAt:
            options.expiresAt ?? new Date(now + 24 * 60 * 60_000).toISOString(),
        assets: options.assets ?? [asset],
    };
}

export function encodeManifest(manifest: SignedUpdateManifest): Buffer {
    return Buffer.from(JSON.stringify(manifest), "utf8");
}

export function signBytes(bytes: Buffer, privateKey: crypto.KeyObject): string {
    return crypto.sign(null, bytes, privateKey).toString("base64");
}
