import { describe, it } from "mocha";
import * as assert from "assert";
import {
    AssetSelectionError,
    selectReleaseAsset,
} from "../src/assets/selectAsset";
import type { AssetSelectionErrorCode } from "../src/assets/selectAsset";
import type { AssetPolicy } from "../src/types";

interface DummyAsset {
    name: string;
    url: string;
}

function asset(name: string): DummyAsset {
    return { name, url: `https://example.test/${encodeURIComponent(name)}` };
}

function policy(overrides: AssetPolicy = {}): AssetPolicy {
    return { product: "Melodify", ...overrides };
}

function select(
    names: string[],
    overrides: AssetPolicy = {},
    platform = "win32",
    arch = "x64"
): DummyAsset {
    return selectReleaseAsset(names.map(asset), policy(overrides), {
        platform,
        arch,
    });
}

function expectSelectionError(
    fn: () => unknown,
    code: AssetSelectionErrorCode
): AssetSelectionError {
    let caught: AssetSelectionError | undefined;
    assert.throws(fn, (error: unknown) => {
        assert.ok(error instanceof AssetSelectionError);
        caught = error;
        return true;
    });
    assert.equal(caught?.code, code);
    return caught!;
}

describe("release asset selection", () => {
    it("selects the single asset matching product, platform and architecture", () => {
        const selected = select([
            "Melodify-1.0.7-win32-arm64.exe",
            "Melodify-1.0.7-win32-x64.exe",
            "Melodify-1.0.7-linux-x64.AppImage",
            "Melodify-1.0.7-full.nupkg",
            "RELEASES",
        ]);

        assert.equal(selected.name, "Melodify-1.0.7-win32-x64.exe");
    });

    it("accepts the currently supported Windows installer formats", () => {
        for (const extension of [".exe", ".msi", ".nsis.zip"]) {
            const name = `Melodify-1.0.7-win32-x64${extension}`;
            assert.equal(select([name]).name, name);
        }
    });

    it("accepts an explicit legacy installer name when no arch-specific asset exists", () => {
        const selected = select(
            ["Melodify.Setup.exe", "Melodify-1.0.7-full.nupkg", "RELEASES"],
            { legacyAssetName: "Melodify.Setup.exe" }
        );

        assert.equal(selected.name, "Melodify.Setup.exe");
    });

    it("uses the documented default legacy setup name on Windows", () => {
        assert.equal(select(["Melodify.Setup.exe"]).name, "Melodify.Setup.exe");
    });

    it("fails on two equally valid candidates", () => {
        const error = expectSelectionError(
            () =>
                select([
                    "Melodify-1.0.6-win32-x64.exe",
                    "Melodify-1.0.7-win32-x64.exe",
                ]),
            "AMBIGUOUS"
        );

        assert.match(error.message, /Ambiguous update asset/);
        assert.deepEqual(error.assets, [
            "Melodify-1.0.6-win32-x64.exe",
            "Melodify-1.0.7-win32-x64.exe",
        ]);
    });

    it("fails on a wrong architecture with a descriptive error", () => {
        const error = expectSelectionError(
            () => select(["Melodify-1.0.7-win32-arm64.exe"]),
            "NO_MATCH"
        );

        assert.match(error.message, /wrong architecture: arm64/);
    });

    it("fails on a wrong platform with a descriptive error", () => {
        const error = expectSelectionError(
            () => select(["Melodify-1.0.7-linux-x64.AppImage"]),
            "NO_MATCH"
        );

        assert.match(error.message, /wrong platform: linux/);
    });

    it("fails the same way for mixed old/new assets in either order", () => {
        const oldAsset = "Melodify.Setup.exe";
        const newAsset = "Melodify-1.0.7-win32-x64.exe";

        const first = expectSelectionError(
            () => select([oldAsset, newAsset]),
            "AMBIGUOUS"
        );
        const second = expectSelectionError(
            () => select([newAsset, oldAsset]),
            "AMBIGUOUS"
        );

        assert.deepEqual(first.assets, [newAsset, oldAsset].sort());
        assert.deepEqual(second.assets, first.assets);
        assert.equal(first.message, second.message);
    });

    it("fails on mixed legacy and architecture-specific assets", () => {
        const error = expectSelectionError(
            () =>
                select([
                    "Melodify.Setup.exe",
                    "Melodify-1.0.7-win32-arm64.exe",
                ]),
            "AMBIGUOUS"
        );

        assert.match(error.message, /Melodify\.Setup\.exe/);
        assert.match(error.message, /arm64\.exe/);
    });

    it("fails when no asset matches", () => {
        const error = expectSelectionError(
            () =>
                select([
                    "OtherApp-1.0.7-win32-x64.exe",
                    "Melodify-1.0.7-win32-arm64.exe",
                ]),
            "NO_MATCH"
        );

        assert.match(error.message, /No update asset matches/);
        assert.match(error.message, /wrong product/);
        assert.match(error.message, /wrong architecture: arm64/);
    });

    it("fails clearly for an empty release", () => {
        const error = expectSelectionError(() => select([]), "NO_MATCH");
        assert.match(error.message, /no assets/i);
    });

    it("rejects a policy that targets a different platform or architecture", () => {
        const platformError = expectSelectionError(
            () =>
                select(
                    ["Melodify-1.0.7-win32-x64.exe"],
                    { platform: "darwin" }
                ),
            "POLICY_MISMATCH"
        );
        assert.match(platformError.message, /darwin/);
        assert.match(platformError.message, /win32/);

        const archError = expectSelectionError(
            () => select(["Melodify-1.0.7-win32-x64.exe"], { arch: "arm64" }),
            "POLICY_MISMATCH"
        );
        assert.match(archError.message, /arm64/);
        assert.match(archError.message, /x64/);
    });

    it("can disable legacy matching explicitly", () => {
        const error = expectSelectionError(
            () =>
                select(["Melodify.Setup.exe"], {
                    legacyAssetName: null,
                }),
            "NO_MATCH"
        );
        assert.match(error.message, /missing architecture token/);
    });
});
