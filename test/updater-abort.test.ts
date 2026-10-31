import { describe, it } from "mocha";
import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import Updater from "../src/index";
import type { DownloadProgress } from "../src/download/Downloader";
import type { UpdateInfo, UpdateOptions } from "../src/types";
import { delay } from "./helpers/fake-http";

interface FakeProvider {
    getLatestRelease(options?: UpdateOptions): Promise<UpdateInfo | null>;
}

interface FakeDownloader {
    downloadAsset(
        url: string,
        dest: string,
        onProgress?: (progress: DownloadProgress) => void,
        expectedSha256?: string,
        options?: UpdateOptions
    ): Promise<string>;
    validateGpg(filePath: string, sigPath: string, keyringPath?: string, options?: UpdateOptions): Promise<void>;
}

function updateInfo(): UpdateInfo {
    return {
        version: "v1.0.7",
        releaseName: "1.0.7",
        releaseNotes: "",
        assets: [
            {
                name: "Melodify Setup.exe",
                url: "https://example.test/setup.exe",
            },
        ],
    };
}

function tempFile(contents = "inert"): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "beu-updater-"));
    const file = path.join(dir, "Melodify Setup.exe");
    fs.writeFileSync(file, contents);
    return file;
}

function downloaderWith(
    fn: (options?: UpdateOptions) => Promise<string>
): FakeDownloader {
    return {
        downloadAsset: (
            _url: string,
            _dest: string,
            _onProgress?: (progress: DownloadProgress) => void,
            _expectedSha256?: string,
            options?: UpdateOptions
        ) => fn(options),
        validateGpg: async () => undefined,
    };
}

function createUpdater(
    downloader: FakeDownloader,
    provider?: FakeProvider,
    autoDownload = false
): Updater {
    const updater = new Updater({
        repo: "owner/repo",
        autoDownload,
        logger: {
            info: () => undefined,
            warn: () => undefined,
            error: () => undefined,
            debug: () => undefined,
        },
    });
    const internals = updater as unknown as {
        githubProvider: FakeProvider;
        downloader: FakeDownloader;
        lastDownloadedPath: string | null;
    };
    internals.githubProvider =
        provider ?? { getLatestRelease: async () => updateInfo() };
    internals.downloader = downloader;
    return updater;
}

describe("Updater cancellation contract", () => {
    it("passes an abort signal to the provider during checkForUpdates", async () => {
        let received: UpdateOptions | undefined;
        const provider: FakeProvider = {
            getLatestRelease: async (options) => {
                received = options;
                return updateInfo();
            },
        };
        const updater = createUpdater(downloaderWith(async () => tempFile()), provider);
        const controller = new AbortController();

        await updater.checkForUpdates({ signal: controller.signal });

        assert.equal(received?.signal instanceof AbortSignal, true);
        assert.equal(received?.signal?.aborted, false);
    });

    it("rejects an already-aborted check before calling the provider", async () => {
        let calls = 0;
        const provider: FakeProvider = {
            getLatestRelease: async () => {
                calls += 1;
                return updateInfo();
            },
        };
        const updater = createUpdater(downloaderWith(async () => tempFile()), provider);
        const controller = new AbortController();
        controller.abort();

        await assert.rejects(
            updater.checkForUpdates({ signal: controller.signal }),
            (error: Error) => error.name === "AbortError"
        );
        assert.equal(calls, 0);
    });

    it("propagates abort while the check is in flight", async () => {
        const controller = new AbortController();
        const provider: FakeProvider = {
            getLatestRelease: (options) =>
                new Promise((_resolve, reject) => {
                    options?.signal?.addEventListener("abort", () =>
                        reject(options.signal?.reason)
                    );
                }),
        };
        const updater = createUpdater(downloaderWith(async () => tempFile()), provider);

        const pending = updater.checkForUpdates({ signal: controller.signal });
        setTimeout(() => controller.abort(), 5);

        await assert.rejects(pending, (error: Error) => error.name === "AbortError");
    });

    it("propagates a check timeout as TimeoutError", async () => {
        const provider: FakeProvider = {
            getLatestRelease: (options) =>
                new Promise((_resolve, reject) => {
                    options?.signal?.addEventListener("abort", () =>
                        reject(options.signal?.reason)
                    );
                }),
        };
        const updater = createUpdater(downloaderWith(async () => tempFile()), provider);

        await assert.rejects(
            updater.checkForUpdates({ timeoutMs: 25 }),
            (error: Error) => error.name === "TimeoutError"
        );
    });

    it("keeps returning null and emitting error for ordinary check failures", async () => {
        const provider: FakeProvider = {
            getLatestRelease: async () => {
                throw new Error("api down");
            },
        };
        const updater = createUpdater(downloaderWith(async () => tempFile()), provider);
        const errors: Error[] = [];
        updater.on("error", (error) => errors.push(error));

        const result = await updater.checkForUpdates();

        assert.equal(result, null);
        assert.equal(errors.length, 1);
    });

    it("keeps the no-options check and download path working", async () => {
        const file = tempFile();
        const updater = createUpdater(downloaderWith(async () => file));
        const available: UpdateInfo[] = [];
        const downloaded: string[] = [];
        updater.on("update-available", (info) => available.push(info));
        updater.on("downloaded", (filePath) => downloaded.push(filePath));

        const info = await updater.checkForUpdates();
        const result = await updater.downloadUpdate();

        assert.equal(info?.version, "v1.0.7");
        assert.equal(available.length, 1);
        assert.equal(result, file);
        assert.deepEqual(downloaded, [file]);
    });

    it("downloads normally and records the path when not aborted", async () => {
        const file = tempFile();
        let received: UpdateOptions | undefined;
        const updater = createUpdater(
            downloaderWith(async (options) => {
                received = options;
                return file;
            })
        );
        const downloaded: string[] = [];
        updater.on("downloaded", (filePath) => downloaded.push(filePath));

        await updater.checkForUpdates();
        const controller = new AbortController();
        const result = await updater.downloadUpdate({ signal: controller.signal });

        assert.equal(result, file);
        assert.deepEqual(downloaded, [file]);
        assert.equal(received?.signal instanceof AbortSignal, true);
        assert.equal(
            (updater as unknown as { lastDownloadedPath: string | null }).lastDownloadedPath,
            file
        );
    });

    it("does not emit downloaded or keep the path when aborted after the downloader resolves", async () => {
        const file = tempFile();
        const controller = new AbortController();
        const updater = createUpdater(
            downloaderWith(async () => {
                controller.abort();
                return file;
            })
        );
        const downloaded: string[] = [];
        const errors: Error[] = [];
        updater.on("downloaded", (filePath) => downloaded.push(filePath));
        updater.on("error", (error) => errors.push(error));

        await updater.checkForUpdates();

        await assert.rejects(
            updater.downloadUpdate({ signal: controller.signal }),
            (error: Error) => error.name === "AbortError"
        );
        assert.deepEqual(downloaded, []);
        assert.deepEqual(errors, []);
        assert.equal(
            (updater as unknown as { lastDownloadedPath: string | null }).lastDownloadedPath,
            null
        );
        assert.equal(fs.existsSync(file), false);
    });

    it("propagates a download timeout and never marks the update as downloaded", async () => {
        const updater = createUpdater(
            downloaderWith(
                (options) =>
                    new Promise((_resolve, reject) => {
                        options?.signal?.addEventListener("abort", () =>
                            reject(options.signal?.reason)
                        );
                    })
            )
        );
        const downloaded: string[] = [];
        const errors: Error[] = [];
        updater.on("downloaded", (filePath) => downloaded.push(filePath));
        updater.on("error", (error) => errors.push(error));

        await updater.checkForUpdates();

        await assert.rejects(
            updater.downloadUpdate({ timeoutMs: 25 }),
            (error: Error) => error.name === "TimeoutError"
        );
        assert.deepEqual(downloaded, []);
        assert.equal(errors.length, 1);
        assert.equal(
            (updater as unknown as { lastDownloadedPath: string | null }).lastDownloadedPath,
            null
        );
    });

    it("does not create an unhandled rejection when autoDownload fails", async () => {
        const updater = createUpdater(
            downloaderWith(async () => {
                throw new Error("download failed");
            }),
            undefined,
            true
        );
        updater.on("error", () => undefined);
        const unhandled: unknown[] = [];
        const onUnhandled = (error: unknown) => unhandled.push(error);
        process.on("unhandledRejection", onUnhandled);

        try {
            await updater.checkForUpdates();
            await delay(25);
        } finally {
            process.off("unhandledRejection", onUnhandled);
        }

        assert.deepEqual(unhandled, []);
    });
});
