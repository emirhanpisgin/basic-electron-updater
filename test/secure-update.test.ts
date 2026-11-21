import { describe, it } from "mocha";
import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import Updater, { type UpdaterDependencies } from "../src/Updater";
import type { UpdateInfo, SecurityOptions } from "../src/types";
import { UpdateSecurityError } from "../src/security/errors";
import {
    encodeManifest,
    generateTestKey,
    makeManifest,
    signBytes,
    type ManifestOptions,
} from "./helpers/manifest";

const INSTALLER = Buffer.from("inert installer bytes for secure update tests");

function silentLogger() {
    return {
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined,
        debug: () => undefined,
    };
}

interface FixtureOptions {
    manifest?: ManifestOptions;
    signature?: string;
    omitManifest?: boolean;
    omitSignature?: boolean;
    installerBytes?: Buffer;
    security?: SecurityOptions;
    apply?: (installerPath: string, platform: string) => Promise<void>;
    installerGate?: Promise<void>;
    onInstaller?: () => void;
}

interface Fixture {
    updater: Updater;
    key: ReturnType<typeof generateTestKey>;
    manifest: ReturnType<typeof makeManifest>;
    info: UpdateInfo;
    installerBytes: Buffer;
    calls: string[];
    installerDestinations: string[];
    applyPaths: string[];
}

function fixture(options: FixtureOptions = {}): Fixture {
    const key = generateTestKey("test-key");
    const installerBytes = options.installerBytes ?? INSTALLER;
    const manifest = makeManifest(installerBytes, {
        keyId: key.keyId,
        ...options.manifest,
    });
    const manifestBytes = encodeManifest(manifest);
    const signature =
        options.signature ?? signBytes(manifestBytes, key.privateKey);
    const installer = manifest.assets[0];
    const base = "https://github.com/owner/repo/releases/download/v1.2.0/";
    const info: UpdateInfo = {
        version: "v1.2.0",
        releaseName: "1.2.0",
        releaseNotes: "",
        assets: [
            {
                name: "update-manifest.json",
                url: base + "update-manifest.json",
                size: manifestBytes.length,
            },
            {
                name: "update-manifest.json.sig",
                url: base + "update-manifest.json.sig",
                size: Buffer.byteLength(signature),
            },
            {
                name: installer.name,
                url: base + installer.name,
                size: installerBytes.length,
            },
        ],
    };
    if (options.omitManifest) info.assets.shift();
    if (options.omitSignature) info.assets.splice(1, 1);

    const calls: string[] = [];
    const installerDestinations: string[] = [];
    const downloader = {
        downloadAsset: async (
            url: string,
            dest: string
        ): Promise<string> => {
            calls.push(url);
            let bytes: Buffer;
            if (url.endsWith(".sig")) {
                bytes = Buffer.from(signature);
            } else if (url.endsWith("update-manifest.json")) {
                bytes = manifestBytes;
            } else {
                installerDestinations.push(dest);
                options.onInstaller?.();
                if (options.installerGate) {
                    await options.installerGate;
                }
                bytes = installerBytes;
            }
            await fs.promises.mkdir(path.dirname(dest), { recursive: true });
            await fs.promises.writeFile(dest, bytes);
            return dest;
        },
    };
    const applyPaths: string[] = [];
    const apply =
        options.apply ??
        (async (installerPath: string) => {
            applyPaths.push(installerPath);
        });

    const updater = new Updater(
        {
            repo: "owner/repo",
            autoDownload: false,
            logger: silentLogger(),
            security: {
                publicKeys: [
                    { keyId: key.keyId, publicKey: key.publicKeyBase64 },
                ],
                ...options.security,
            },
        },
        {
            githubProvider: { getLatestRelease: async () => info },
            downloader,
            applyUpdate: apply,
        } as UpdaterDependencies
    );

    return {
        updater,
        key,
        manifest,
        info,
        installerBytes,
        calls,
        installerDestinations,
        applyPaths,
    };
}

function expectSecurityCode(error: unknown, code: string): boolean {
    return error instanceof UpdateSecurityError && error.code === code;
}

describe("secure update flow", () => {
    it("requires a signed manifest and verifies the installer before download completion", async () => {
        const f = fixture();
        const downloaded: string[] = [];
        f.updater.on("downloaded", (filePath) => downloaded.push(filePath));

        const info = await f.updater.checkForUpdates();
        const installerPath = await f.updater.downloadUpdate();

        assert.equal(info?.version, "v1.2.0");
        assert.equal(downloaded.length, 1);
        assert.equal(downloaded[0], installerPath);
        assert.equal(fs.existsSync(installerPath), true);
        assert.equal(fs.readFileSync(installerPath).equals(f.installerBytes), true);
        assert.equal(f.calls.filter((url) => url.endsWith(".sig")).length, 1);
        assert.equal(f.calls.filter((url) => url.endsWith("update-manifest.json")).length, 1);
    });

    it("rejects a missing or invalid signature before downloading an installer", async () => {
        for (const [code, options] of [
            ["INVALID_SIGNATURE", { signature: "not-a-signature" }],
            ["MANIFEST_MISSING", { omitSignature: true }],
            ["MANIFEST_MISSING", { omitManifest: true }],
        ] as const) {
            const f = fixture(options);
            await assert.rejects(
                f.updater.checkForUpdates(),
                (error: unknown) => expectSecurityCode(error, code)
            );
            assert.equal(
                f.calls.some((url) => url.endsWith(".exe")),
                false
            );
        }
    });

    it("rejects a manifest signed by a different key", async () => {
        const other = generateTestKey("other-key");
        const f = fixture({
            signature: signBytes(
                encodeManifest(makeManifest(INSTALLER, { keyId: "other-key" })),
                other.privateKey
            ),
        });

        await assert.rejects(
            f.updater.checkForUpdates(),
            (error: unknown) => expectSecurityCode(error, "UNKNOWN_KEY")
        );
        assert.equal(f.calls.some((url) => url.endsWith(".exe")), false);
    });

    it("rejects a manifest version that does not match the release", async () => {
        const f = fixture({ manifest: { version: "v1.3.0" } });
        await assert.rejects(
            f.updater.checkForUpdates(),
            (error: unknown) => expectSecurityCode(error, "WRONG_VERSION")
        );
        assert.equal(f.calls.some((url) => url.endsWith(".exe")), false);
    });

    it("rejects an unsafe or unsupported manifest asset name", async () => {
        const f = fixture({
            manifest: {
                assets: [
                    {
                        name: "../evil.exe",
                        size: INSTALLER.length,
                        sha256: "0".repeat(64),
                    },
                ],
            },
        });
        await assert.rejects(
            f.updater.checkForUpdates(),
            (error: unknown) => expectSecurityCode(error, "UNSAFE_ASSET")
        );
        assert.equal(f.calls.some((url) => url.endsWith(".exe")), false);
    });

    it("rejects a missing or malformed signed hash", async () => {
        const f = fixture({
            manifest: {
                assets: [
                    {
                        name: "Melodify-1.2.0-win32-x64.exe",
                        size: INSTALLER.length,
                        sha256: "",
                    },
                ],
            },
        });
        await assert.rejects(
            f.updater.checkForUpdates(),
            (error: unknown) => expectSecurityCode(error, "INVALID_MANIFEST")
        );
        assert.equal(f.calls.some((url) => url.endsWith(".exe")), false);
    });

    it("rejects a downloaded installer whose bytes do not match the signed hash", async () => {
        const f = fixture({
            manifest: {
                assets: [
                    {
                        name: "Melodify-1.2.0-win32-x64.exe",
                        size: INSTALLER.length,
                        sha256: "0".repeat(64),
                    },
                ],
            },
        });
        const downloaded: string[] = [];
        f.updater.on("downloaded", (filePath) => downloaded.push(filePath));

        await f.updater.checkForUpdates();
        await assert.rejects(
            f.updater.downloadUpdate(),
            (error: unknown) => expectSecurityCode(error, "HASH_MISMATCH")
        );
        assert.deepEqual(downloaded, []);
        assert.equal(f.installerDestinations.length, 1);
        assert.equal(fs.existsSync(f.installerDestinations[0]), false);
    });

    it("re-verifies the exact artifact before applying and never launches after tampering", async () => {
        const f = fixture();
        await f.updater.checkForUpdates();
        const installerPath = await f.updater.downloadUpdate();
        fs.appendFileSync(installerPath, "tampered");

        await assert.rejects(
            f.updater.applyUpdate(),
            (error: unknown) => expectSecurityCode(error, "SIZE_MISMATCH")
        );
        assert.deepEqual(f.applyPaths, []);
    });

    it("re-verifies the hash even when a tampered file keeps its size", async () => {
        const f = fixture();
        await f.updater.checkForUpdates();
        const installerPath = await f.updater.downloadUpdate();
        const fd = fs.openSync(installerPath, "r+");
        try {
            fs.writeSync(fd, Buffer.from([0x00]), 0, 1, 0);
        } finally {
            fs.closeSync(fd);
        }

        await assert.rejects(
            f.updater.applyUpdate(),
            (error: unknown) => expectSecurityCode(error, "HASH_MISMATCH")
        );
        assert.deepEqual(f.applyPaths, []);
    });

    it("refuses to apply without a verified signed artifact", async () => {
        const f = fixture();
        await assert.rejects(
            f.updater.applyUpdate(),
            /No downloaded update/
        );
        assert.deepEqual(f.applyPaths, []);
    });

    it("does not treat an older or equal release as an update", async () => {
        const f = fixture();
        (f.updater as unknown as { currentVersion: string }).currentVersion = "1.2.0";
        const available: UpdateInfo[] = [];
        f.updater.on("update-available", (info) => available.push(info));

        assert.equal(await f.updater.checkForUpdates(), null);
        assert.deepEqual(available, []);
        assert.equal(f.calls.length, 0);
    });

    it("does not offer an invalid semantic version", async () => {
        const f = fixture();
        f.info.version = "not-a-version";
        assert.equal(await f.updater.checkForUpdates(), null);
        assert.equal(f.calls.length, 0);
    });

    it("rejects a direct download of an older or equal release after no-update", async () => {
        for (const currentVersion of ["1.2.0", "1.2.1"]) {
            const f = fixture();
            (f.updater as unknown as { currentVersion: string }).currentVersion =
                currentVersion;
            const downloaded: string[] = [];
            f.updater.on("downloaded", (filePath) => downloaded.push(filePath));

            assert.equal(await f.updater.checkForUpdates(), null);
            await assert.rejects(
                f.updater.downloadUpdate(),
                (error: unknown) => expectSecurityCode(error, "DOWNGRADE")
            );
            assert.deepEqual(downloaded, []);
            assert.equal(f.calls.length, 0);
        }
    });

    it("rejects a stale artifact at apply if the running version is no longer older", async () => {
        const f = fixture();
        await f.updater.checkForUpdates();
        await f.updater.downloadUpdate();
        (f.updater as unknown as { currentVersion: string }).currentVersion = "1.2.0";

        await assert.rejects(
            f.updater.applyUpdate(),
            (error: unknown) => expectSecurityCode(error, "DOWNGRADE")
        );
        assert.deepEqual(f.applyPaths, []);
    });

    it("rejects an expired artifact at the final apply step", async () => {
        const f = fixture();
        await f.updater.checkForUpdates();
        await f.updater.downloadUpdate();
        const artifact = (
            f.updater as unknown as {
                lastVerifiedArtifact: { manifest: { expiresAt: string } } | null;
            }
        ).lastVerifiedArtifact;
        assert.ok(artifact);
        artifact!.manifest.expiresAt = new Date(Date.now() - 1_000).toISOString();

        await assert.rejects(
            f.updater.applyUpdate(),
            (error: unknown) => expectSecurityCode(error, "EXPIRED_MANIFEST")
        );
        assert.deepEqual(f.applyPaths, []);
    });

    it("runs an optional Authenticode verifier before launch and blocks on failure", async () => {
        let verifierCalled = false;
        const f = fixture({
            security: {
                requireAuthenticode: true,
                expectedWindowsPublisher: "CN=Expected Publisher",
                authenticodeVerifier: async () => {
                    verifierCalled = true;
                    throw new Error("unexpected publisher");
                },
            },
        });
        await f.updater.checkForUpdates();
        const installerPath = await f.updater.downloadUpdate();
        assert.equal(fs.existsSync(installerPath), true);

        await assert.rejects(
            f.updater.applyUpdate(),
            (error: unknown) => expectSecurityCode(error, "AUTHENTICODE_FAILED")
        );
        assert.equal(verifierCalled, true);
        assert.deepEqual(f.applyPaths, []);
    });

    it("prevents concurrent installer launches", async () => {
        let release: (() => void) | undefined;
        let started: (() => void) | undefined;
        const startedPromise = new Promise<void>((resolve) => {
            started = resolve;
        });
        const f = fixture({
            apply: () =>
                new Promise<void>((resolve) => {
                    release = resolve;
                    started?.();
                }),
        });
        await f.updater.checkForUpdates();
        await f.updater.downloadUpdate();

        const first = f.updater.applyUpdate();
        await startedPromise;
        await assert.rejects(
            f.updater.applyUpdate(),
            (error: unknown) => expectSecurityCode(error, "CONCURRENT_UPDATE")
        );
        release?.();
        await first;
    });

    it("prevents concurrent downloads", async () => {
        let release: (() => void) | undefined;
        let started: (() => void) | undefined;
        const startedPromise = new Promise<void>((resolve) => {
            started = resolve;
        });
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        const f = fixture({
            installerGate: gate,
            onInstaller: () => started?.(),
        });
        await f.updater.checkForUpdates();

        const first = f.updater.downloadUpdate();
        await startedPromise;
        await assert.rejects(
            f.updater.downloadUpdate(),
            (error: unknown) => expectSecurityCode(error, "CONCURRENT_UPDATE")
        );
        release?.();
        await first;
    });
});
