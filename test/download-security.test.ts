import { describe, it } from "mocha";
import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { Downloader } from "../src/download/Downloader";
import type { DownloadPolicy } from "../src/download/urlPolicy";
import { createFakeRequest, respondWith } from "./helpers/fake-http";

function tempDest(): string {
    return path.join(
        fs.mkdtempSync(path.join(os.tmpdir(), "beu-download-security-")),
        "app.exe"
    );
}

function download(
    names: string[],
    policy?: DownloadPolicy,
    handler?: Parameters<typeof createFakeRequest>[0]
): Promise<string> {
    const fake = createFakeRequest(
        handler ??
            ((call) => {
                respondWith(call, Buffer.from("inert"));
            })
    );
    const downloader = new Downloader(fake);
    return downloader.downloadAsset(
        names[0],
        tempDest(),
        undefined,
        undefined,
        undefined,
        policy
    );
}

describe("download URL and size policy", () => {
    it("rejects credentials embedded in a URL before requesting", async () => {
        await assert.rejects(
            download(["https://user:pass@example.test/app.exe"]),
            (error: Error) => /credentials/i.test(error.message)
        );
    });

    it("rejects HTTP and private/loopback destinations before requesting", async () => {
        for (const url of [
            "http://example.test/app.exe",
            "https://127.0.0.1/app.exe",
            "https://10.0.0.1/app.exe",
            "https://192.168.1.5/app.exe",
            "https://[::1]/app.exe",
            "https://localhost/app.exe",
        ]) {
            await assert.rejects(
                download([url]),
                (error: Error) =>
                    /insecure|private|loopback|local|credentials/i.test(error.message)
            );
        }
    });

    it("rejects a redirect outside the allow-list", async () => {
        const fake = createFakeRequest((call, index) => {
            if (index === 0) {
                call.response.statusCode = 302;
                call.response.headers = {
                    location: "https://evil.test/app.exe",
                };
                call.response.end();
            } else {
                respondWith(call, "should not be reached");
            }
        });
        const downloader = new Downloader(fake);
        await assert.rejects(
            downloader.downloadAsset(
                "https://example.test/app.exe",
                tempDest(),
                undefined,
                undefined,
                undefined,
                { allowedHosts: ["example.test"] }
            ),
            (error: Error) => /not allowed/i.test(error.message)
        );
        assert.equal(fake.calls.length, 1);
    });

    it("rejects a redirect to a private address", async () => {
        const fake = createFakeRequest((call) => {
            call.response.statusCode = 302;
            call.response.headers = { location: "https://127.0.0.1/app.exe" };
            call.response.end();
        });
        const downloader = new Downloader(fake);
        await assert.rejects(
            downloader.downloadAsset(
                "https://example.test/app.exe",
                tempDest(),
                undefined,
                undefined,
                undefined,
                { allowedHosts: ["example.test"] }
            ),
            (error: Error) => /private|loopback|local/i.test(error.message)
        );
    });

    it("rejects a declared content length above the configured maximum without writing", async () => {
        const dest = tempDest();
        const body = Buffer.alloc(128, 1);
        const fake = createFakeRequest((call) => respondWith(call, body));
        const downloader = new Downloader(fake);
        await assert.rejects(
            downloader.downloadAsset(
                "https://example.test/app.exe",
                dest,
                undefined,
                undefined,
                undefined,
                { maxBytes: 64 }
            ),
            (error: Error) => /maximum size/i.test(error.message)
        );
        assert.equal(fs.existsSync(dest), false);
    });

    it("aborts an oversized stream and removes the partial file", async () => {
        const dest = tempDest();
        const fake = createFakeRequest((call) => {
            call.response.statusCode = 200;
            call.response.headers = {};
            call.response.complete = true;
            call.response.end(Buffer.alloc(128, 1));
        });
        const downloader = new Downloader(fake);
        await assert.rejects(
            downloader.downloadAsset(
                "https://example.test/app.exe",
                dest,
                undefined,
                undefined,
                undefined,
                { maxBytes: 64 }
            ),
            (error: Error) => /maximum size|premature/i.test(error.message)
        );
        assert.equal(fs.existsSync(dest), false);
    });

    it("times out a request that does not respond", async () => {
        const fake = createFakeRequest(undefined, false);
        const downloader = new Downloader(fake);
        await assert.rejects(
            downloader.downloadAsset(
                "https://example.test/app.exe",
                tempDest(),
                undefined,
                undefined,
                undefined,
                { requestTimeoutMs: 20 }
            ),
            (error: Error) => error.name === "TimeoutError"
        );
    });
});
