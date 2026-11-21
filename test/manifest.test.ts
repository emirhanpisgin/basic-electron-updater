import { describe, it } from "mocha";
import * as assert from "assert";
import * as crypto from "crypto";
import { parseTrustedPublicKeys, verifyDetachedSignature } from "../src/security/keys";
import {
    verifySignedManifest,
    type ManifestExpectations,
} from "../src/security/manifest";
import { UpdateSecurityError } from "../src/security/errors";
import {
    encodeManifest,
    generateTestKey,
    makeManifest,
    signBytes,
} from "./helpers/manifest";

const INSTALLER = Buffer.from("inert installer bytes");
const EXPECTED: ManifestExpectations = {
    appId: "owner/repo",
    version: "v1.2.0",
    platform: "win32",
    architecture: "x64",
    channel: "latest",
    maxAssetBytes: 1024 * 1024,
};

function setup(overrides: Parameters<typeof makeManifest>[1] = {}) {
    const key = generateTestKey(overrides.keyId ?? "test-key");
    const manifest = makeManifest(INSTALLER, overrides);
    const bytes = encodeManifest(manifest);
    const signature = signBytes(bytes, key.privateKey);
    const keys = parseTrustedPublicKeys([
        { keyId: key.keyId, publicKey: key.publicKeyBase64 },
    ]);
    return { key, manifest, bytes, signature, keys };
}

function expectSecurityError(
    fn: () => unknown,
    code: string
): UpdateSecurityError {
    let caught: UpdateSecurityError | undefined;
    assert.throws(fn, (error: unknown) => {
        assert.ok(error instanceof UpdateSecurityError);
        caught = error;
        return true;
    });
    assert.equal(caught?.code, code);
    return caught!;
}

describe("signed update manifests", () => {
    it("accepts a correctly signed manifest and validates fields", () => {
        const { bytes, signature, keys } = setup();
        const verified = verifySignedManifest(bytes, signature, keys, EXPECTED);

        assert.equal(verified.manifest.appId, "owner/repo");
        assert.equal(verified.manifest.version, "1.2.0");
        assert.equal(verified.manifest.assets[0].sha256.length, 64);
        assert.equal(verified.keyId, "test-key");
    });

    it("rejects a manifest modified after signing", () => {
        const { bytes, signature, keys } = setup();
        const modified = Buffer.from(bytes);
        modified[modified.indexOf("1.2.0")] = "9".charCodeAt(0);

        expectSecurityError(
            () => verifySignedManifest(modified, signature, keys, EXPECTED),
            "UNKNOWN_KEY"
        );
    });

    it("rejects a signature made by an unpinned key", () => {
        const { bytes, signature } = setup();
        const other = generateTestKey("test-key");
        const otherKeys = parseTrustedPublicKeys([
            { keyId: other.keyId, publicKey: other.publicKeyBase64 },
        ]);

        expectSecurityError(
            () => verifySignedManifest(bytes, signature, otherKeys, EXPECTED),
            "UNKNOWN_KEY"
        );
    });

    it("rejects missing, malformed and wrong-length signatures", () => {
        const { bytes, keys } = setup();
        for (const signature of ["", "not-base64!", Buffer.alloc(63).toString("base64")]) {
            expectSecurityError(
                () => verifySignedManifest(bytes, signature, keys, EXPECTED),
                "INVALID_SIGNATURE"
            );
        }
    });

    it("rejects a manifest whose keyId does not match the verified key", () => {
        const { bytes, signature } = setup();
        const key = generateTestKey("other-key");
        const keys = parseTrustedPublicKeys([
            { keyId: key.keyId, publicKey: key.publicKeyBase64 },
        ]);

        expectSecurityError(
            () => verifySignedManifest(bytes, signature, keys, EXPECTED),
            "UNKNOWN_KEY"
        );
    });

    it("rejects an expired manifest", () => {
        const { bytes, signature, keys } = setup({
            publishedAt: new Date(Date.now() - 60_000).toISOString(),
            expiresAt: new Date(Date.now() - 1_000).toISOString(),
        });

        expectSecurityError(
            () => verifySignedManifest(bytes, signature, keys, EXPECTED),
            "EXPIRED_MANIFEST"
        );
    });

    it("rejects a manifest published in the future", () => {
        const { bytes, signature, keys } = setup({
            publishedAt: new Date(Date.now() + 60 * 60_000).toISOString(),
            expiresAt: new Date(Date.now() + 2 * 60 * 60_000).toISOString(),
        });

        expectSecurityError(
            () => verifySignedManifest(bytes, signature, keys, EXPECTED),
            "INVALID_MANIFEST"
        );
    });

    it("rejects unknown top-level and asset fields", () => {
        const { key } = setup();
        const withUnknown = {
            ...makeManifest(INSTALLER),
            algorithm: "ed25519",
        };
        const bytes = Buffer.from(JSON.stringify(withUnknown));
        const signature = signBytes(bytes, key.privateKey);
        const keys = parseTrustedPublicKeys([
            { keyId: key.keyId, publicKey: key.publicKeyBase64 },
        ]);

        expectSecurityError(
            () => verifySignedManifest(bytes, signature, keys, EXPECTED),
            "INVALID_MANIFEST"
        );

        const badAsset = makeManifest(INSTALLER, {
            assets: [
                {
                    name: "Melodify-1.2.0-win32-x64.exe",
                    size: INSTALLER.length,
                    sha256: "0".repeat(64),
                    url: "https://attacker.test/x",
                } as never,
            ],
        });
        const badBytes = encodeManifest(badAsset);
        const badSignature = signBytes(badBytes, key.privateKey);
        expectSecurityError(
            () => verifySignedManifest(badBytes, badSignature, keys, EXPECTED),
            "INVALID_MANIFEST"
        );
    });

    it("binds app, version, platform, architecture and channel", () => {
        const { key } = setup();
        const keys = parseTrustedPublicKeys([
            { keyId: key.keyId, publicKey: key.publicKeyBase64 },
        ]);
        const cases: Array<[string, Partial<Parameters<typeof makeManifest>[1]>, string]> = [
            ["app", { appId: "other/repo" }, "WRONG_APP"],
            ["version", { version: "v1.3.0" }, "WRONG_VERSION"],
            ["platform", { platform: "linux" }, "WRONG_PLATFORM"],
            ["architecture", { architecture: "arm64" }, "WRONG_ARCHITECTURE"],
            ["channel", { channel: "beta" }, "WRONG_CHANNEL"],
        ];
        for (const [, overrides, code] of cases) {
            const manifest = makeManifest(INSTALLER, overrides);
            const bytes = encodeManifest(manifest);
            const signature = signBytes(bytes, key.privateKey);
            expectSecurityError(
                () => verifySignedManifest(bytes, signature, keys, EXPECTED),
                code
            );
        }
    });

    it("rejects unsafe asset names and unsupported extensions", () => {
        for (const name of [
            "../evil.exe",
            "dir/Melodify-1.2.0-win32-x64.exe",
            "..\\evil.exe",
            "Melodify-1.2.0-win32-x64.txt",
        ]) {
            const { key } = setup();
            const manifest = makeManifest(INSTALLER, {
                assets: [{ name, size: INSTALLER.length, sha256: "0".repeat(64) }],
            });
            const bytes = encodeManifest(manifest);
            const signature = signBytes(bytes, key.privateKey);
            const keys = parseTrustedPublicKeys([
                { keyId: key.keyId, publicKey: key.publicKeyBase64 },
            ]);
            expectSecurityError(
                () => verifySignedManifest(bytes, signature, keys, EXPECTED),
                name.includes("/") || name.includes("\\") ? "UNSAFE_ASSET" : "INVALID_MANIFEST"
            );
        }
    });

    it("requires exactly one asset with a valid hash and bounded size", () => {
        const { key } = setup();
        const keys = parseTrustedPublicKeys([
            { keyId: key.keyId, publicKey: key.publicKeyBase64 },
        ]);
        const cases = [
            { assets: [] },
            {
                assets: [
                    {
                        name: "Melodify-1.2.0-win32-x64.exe",
                        size: INSTALLER.length,
                        sha256: "not-a-hash",
                    },
                ],
            },
            {
                assets: [
                    {
                        name: "Melodify-1.2.0-win32-x64.exe",
                        size: 0,
                        sha256: "0".repeat(64),
                    },
                ],
            },
            {
                assets: [
                    {
                        name: "Melodify-1.2.0-win32-x64.exe",
                        size: 2 * 1024 * 1024,
                        sha256: "0".repeat(64),
                    },
                ],
            },
        ];
        for (const overrides of cases) {
            const manifest = makeManifest(INSTALLER, overrides as never);
            const bytes = encodeManifest(manifest);
            const signature = signBytes(bytes, key.privateKey);
            expectSecurityError(
                () => verifySignedManifest(bytes, signature, keys, EXPECTED),
                "INVALID_MANIFEST"
            );
        }
    });

    it("rejects non-Ed25519 and duplicate pinned keys", () => {
        const rsa = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
        const rsaPublic = rsa.publicKey
            .export({ format: "der", type: "spki" })
            .toString("base64");
        assert.throws(
            () =>
                parseTrustedPublicKeys([
                    { keyId: "rsa", publicKey: rsaPublic },
                ]),
            /must be Ed25519/
        );
        const key = generateTestKey();
        assert.throws(
            () =>
                parseTrustedPublicKeys([
                    { keyId: "same", publicKey: key.publicKeyBase64 },
                    { keyId: "same", publicKey: key.publicKeyBase64 },
                ]),
            /Duplicate/
        );
    });

    it("supports rotation with multiple pinned keys", () => {
        const oldKey = generateTestKey("old-key");
        const newKey = generateTestKey("new-key");
        const manifest = makeManifest(INSTALLER, { keyId: "new-key" });
        const bytes = encodeManifest(manifest);
        const signature = signBytes(bytes, newKey.privateKey);
        const keys = parseTrustedPublicKeys([
            { keyId: oldKey.keyId, publicKey: oldKey.publicKeyBase64 },
            { keyId: newKey.keyId, publicKey: newKey.publicKeyBase64 },
        ]);

        const verified = verifySignedManifest(bytes, signature, keys, EXPECTED);
        assert.equal(verified.keyId, "new-key");
    });

    it("verifies a signature only for the matching pinned key id", () => {
        const key = generateTestKey("one");
        const keys = parseTrustedPublicKeys([
            { keyId: "one", publicKey: key.publicKeyBase64 },
        ]);
        const bytes = Buffer.from("payload");
        const signature = signBytes(bytes, key.privateKey);
        assert.equal(
            verifyDetachedSignature(bytes, signature, keys, "one").keyId,
            "one"
        );
        expectSecurityError(
            () => verifyDetachedSignature(bytes, signature, keys, "two"),
            "INVALID_SIGNATURE"
        );
    });
});
