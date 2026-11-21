import { describe, it } from "mocha";
import * as assert from "assert";
import {
    DEFAULT_ALLOWED_DOWNLOAD_HOSTS,
    resolveSecurityOptions,
} from "../src/security/config";
import { SecurityConfigError } from "../src/security/errors";
import { generateTestKey } from "./helpers/manifest";

function expectConfigError(fn: () => unknown, code: string): void {
    let caught: unknown;
    assert.throws(fn, (error: unknown) => {
        caught = error;
        return true;
    });
    assert.ok(caught instanceof SecurityConfigError);
    assert.equal(caught.code, code);
}

describe("security configuration", () => {
    it("fails closed without pinned keys", () => {
        expectConfigError(
            () => resolveSecurityOptions(undefined, "owner/repo"),
            "INSECURE_CONFIG"
        );
    });

    it("requires an explicit legacy opt-in and consistent flags", () => {
        expectConfigError(
            () =>
                resolveSecurityOptions(
                    { allowUnsignedUpdates: true },
                    "owner/repo"
                ),
            "INSECURE_CONFIG"
        );
        expectConfigError(
            () =>
                resolveSecurityOptions(
                    { requireManifestSignature: false },
                    "owner/repo"
                ),
            "INSECURE_CONFIG"
        );
        const legacy = resolveSecurityOptions(
            {
                allowUnsignedUpdates: true,
                requireManifestSignature: false,
                requireSha256: false,
            },
            "owner/repo"
        );
        assert.equal(legacy.allowUnsignedUpdates, true);
        assert.equal(legacy.requireManifestSignature, false);
    });

    it("does not allow disabling SHA-256 in signed mode", () => {
        const key = generateTestKey();
        expectConfigError(
            () =>
                resolveSecurityOptions(
                    {
                        publicKeys: [
                            { keyId: key.keyId, publicKey: key.publicKeyBase64 },
                        ],
                        requireSha256: false,
                    },
                    "owner/repo"
                ),
            "INSECURE_CONFIG"
        );
    });

    it("uses secure defaults for signed mode", () => {
        const key = generateTestKey();
        const resolved = resolveSecurityOptions(
            {
                publicKeys: [
                    { keyId: key.keyId, publicKey: key.publicKeyBase64 },
                ],
            },
            "owner/repo"
        );
        assert.equal(resolved.requireManifestSignature, true);
        assert.equal(resolved.requireSha256, true);
        assert.deepEqual(resolved.allowedDownloadHosts, [
            ...DEFAULT_ALLOWED_DOWNLOAD_HOSTS,
        ]);
        assert.equal(resolved.maxManifestBytes, 64 * 1024);
        assert.equal(resolved.requestTimeoutMs, 30_000);
        assert.equal(resolved.appId, "owner/repo");
    });

    it("rejects malformed and duplicate keys and invalid hosts", () => {
        const key = generateTestKey();
        expectConfigError(
            () =>
                resolveSecurityOptions(
                    {
                        publicKeys: [{ keyId: "", publicKey: key.publicKeyBase64 }],
                    },
                    "owner/repo"
                ),
            "INVALID_PUBLIC_KEY"
        );
        expectConfigError(
            () =>
                resolveSecurityOptions(
                    {
                        publicKeys: [
                            { keyId: "same", publicKey: key.publicKeyBase64 },
                            { keyId: "same", publicKey: key.publicKeyBase64 },
                        ],
                    },
                    "owner/repo"
                ),
            "INVALID_PUBLIC_KEY"
        );
        expectConfigError(
            () =>
                resolveSecurityOptions(
                    {
                        publicKeys: [
                            { keyId: key.keyId, publicKey: key.publicKeyBase64 },
                        ],
                        allowedDownloadHosts: ["https://github.com"],
                    },
                    "owner/repo"
                ),
            "INSECURE_CONFIG"
        );
    });

    it("requires a verifier when Authenticode is required", () => {
        const key = generateTestKey();
        expectConfigError(
            () =>
                resolveSecurityOptions(
                    {
                        publicKeys: [
                            { keyId: key.keyId, publicKey: key.publicKeyBase64 },
                        ],
                        requireAuthenticode: true,
                    },
                    "owner/repo"
                ),
            "AUTHENTICODE_REQUIRED"
        );
    });

    it("accepts multiple pinned keys for rotation", () => {
        const first = generateTestKey("key-1");
        const second = generateTestKey("key-2");
        const resolved = resolveSecurityOptions(
            {
                publicKeys: [
                    { keyId: first.keyId, publicKey: first.publicKeyBase64 },
                    { keyId: second.keyId, publicKey: second.publicKeyBase64 },
                ],
            },
            "owner/repo"
        );
        assert.equal(resolved.parsedPublicKeys.length, 2);
    });
});
