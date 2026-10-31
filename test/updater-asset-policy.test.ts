import { describe, it } from "mocha";
import * as assert from "assert";
import Updater from "../src/index";
import { AssetSelectionError } from "../src/assets/selectAsset";
import type { DownloadProgress } from "../src/download/Downloader";
import type { UpdateInfo, UpdateOptions } from "../src/types";

interface FakeDownloader {
    downloadAsset(
        url: string,
        dest: string,
        onProgress?: (progress: DownloadProgress) => void,
        expectedSha256?: string,
        options?: UpdateOptions
    ): Promise<string>;
    validateGpg(
        filePath: string,
        sigPath: string,
        keyringPath?: string,
        options?: UpdateOptions
    ): Promise<void>;
}

function releaseWith(assetNames: string[]): UpdateInfo {
    return {
        version: "v1.0.7",
        releaseName: "1.0.7",
        releaseNotes: "",
        assets: assetNames.map((name) => ({
            name,
            url: `https://example.test/${encodeURIComponent(name)}`,
        })),
    };
}

function createUpdater(assets: string[]): {
    updater: Updater;
    calls: string[];
} {
    const updater = new Updater({
        repo: "MelodifyApp/melodify",
        autoDownload: false,
        logger: {
            info: () => undefined,
            warn: () => undefined,
            error: () => undefined,
            debug: () => undefined,
        },
    });
    (updater as unknown as { githubProvider: unknown }).githubProvider = {
        getLatestRelease: async () => releaseWith(assets),
    };

    const calls: string[] = [];
    const downloader: FakeDownloader = {
        downloadAsset: async (url) => {
            calls.push(url);
            return "C:\\Temp\\Melodify.Setup.exe";
        },
        validateGpg: async () => undefined,
    };
    (updater as unknown as { downloader: FakeDownloader }).downloader = downloader;
    return { updater, calls };
}

describe("Updater asset policy wiring", () => {
    it("downloads the asset selected by the configured contract", async () => {
        const { updater, calls } = createUpdater([
            "Melodify-1.0.7-win32-arm64.exe",
            "Melodify-1.0.7-win32-x64.exe",
            "Melodify-1.0.7-linux-x64.AppImage",
        ]);

        await updater.checkForUpdates();
        await updater.downloadUpdate();

        assert.deepEqual(calls, [
            `https://example.test/${encodeURIComponent(
                "Melodify-1.0.7-win32-x64.exe"
            )}`,
        ]);
    });

    it("keeps the default legacy Melodify.Setup.exe working", async () => {
        const { updater, calls } = createUpdater(["Melodify.Setup.exe"]);

        await updater.checkForUpdates();
        await updater.downloadUpdate();

        assert.deepEqual(calls, [
            `https://example.test/${encodeURIComponent("Melodify.Setup.exe")}`,
        ]);
    });

    it("refuses to download when two assets are equally valid", async () => {
        const { updater, calls } = createUpdater([
            "Melodify-1.0.6-win32-x64.exe",
            "Melodify-1.0.7-win32-x64.exe",
        ]);
        await updater.checkForUpdates();

        await assert.rejects(
            updater.downloadUpdate(),
            (error: unknown) =>
                error instanceof AssetSelectionError &&
                error.code === "AMBIGUOUS"
        );
        assert.deepEqual(calls, []);
    });

    it("refuses to download when no asset matches", async () => {
        const { updater, calls } = createUpdater([
            "OtherApp-1.0.7-win32-x64.exe",
        ]);
        await updater.checkForUpdates();

        await assert.rejects(
            updater.downloadUpdate(),
            (error: unknown) =>
                error instanceof AssetSelectionError &&
                error.code === "NO_MATCH"
        );
        assert.deepEqual(calls, []);
    });
});
