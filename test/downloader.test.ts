import { describe, it } from "mocha";
import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { Downloader } from "../src/download/Downloader";
import {
    createFakeRequest,
    delay,
    respondWith,
} from "./helpers/fake-http";

const URL = "https://example.test/apps/Melodify%20Setup.exe";

function tempDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), "beu-downloader-"));
}

describe("Downloader cancellable transport", () => {
    it("downloads a complete asset and reports progress", async () => {
        const dir = tempDir();
        const dest = path.join(dir, "app.exe");
        const body = Buffer.from("inert installer bytes");
        const fake = createFakeRequest((call) => respondWith(call, body));
        const progress: number[] = [];
        const downloader = new Downloader(fake);

        const result = await downloader.downloadAsset(URL, dest, (p) => progress.push(p.transferred));

        assert.equal(result, dest);
        assert.equal(fs.readFileSync(dest, "utf8"), body.toString());
        assert.equal(fake.calls.length, 1);
        assert.deepEqual(progress, [body.length]);
    });

    it("rejects with AbortError, removes the partial file and destroys the request", async () => {
        const dir = tempDir();
        const dest = path.join(dir, "app.exe");
        const fake = createFakeRequest((call) => {
            call.response.statusCode = 200;
            call.response.headers = { "content-length": "100" };
            call.response.complete = false;
            call.response.write(Buffer.alloc(10, 1));
        });
        const downloader = new Downloader(fake);
        const controller = new AbortController();

        const promise = downloader.downloadAsset(URL, dest, undefined, undefined, {
            signal: controller.signal,
        });
        controller.abort();

        await assert.rejects(promise, (error: Error) => error.name === "AbortError");
        assert.equal(fs.existsSync(dest), false);
        assert.equal(fake.calls[0]?.request.destroyed, true);
    });

    it("rejects with TimeoutError and cleans up a stalled request", async () => {
        const dir = tempDir();
        const dest = path.join(dir, "app.exe");
        const fake = createFakeRequest((call) => {
            call.response.statusCode = 200;
            call.response.headers = { "content-length": "100" };
            call.response.complete = false;
            call.response.write(Buffer.alloc(5, 1));
        });
        const downloader = new Downloader(fake);

        await assert.rejects(
            downloader.downloadAsset(URL, dest, undefined, undefined, { timeoutMs: 25 }),
            (error: Error) => error.name === "TimeoutError"
        );
        assert.equal(fs.existsSync(dest), false);
        assert.equal(fake.calls[0]?.request.destroyed, true);
    });

    it("rejects when the response stream fails and removes the partial file", async () => {
        const dir = tempDir();
        const dest = path.join(dir, "app.exe");
        const fake = createFakeRequest((call) => {
            call.response.statusCode = 200;
            call.response.headers = { "content-length": "100" };
            call.response.complete = false;
            call.response.write(Buffer.alloc(4, 1));
            setTimeout(() => call.response.destroy(new Error("response broke")), 5);
        });
        const downloader = new Downloader(fake);

        await assert.rejects(downloader.downloadAsset(URL, dest), /response broke/);
        assert.equal(fs.existsSync(dest), false);
    });

    it("rejects when the response closes early without an error", async () => {
        const dir = tempDir();
        const dest = path.join(dir, "app.exe");
        const fake = createFakeRequest((call) => {
            call.response.statusCode = 200;
            call.response.headers = { "content-length": "100" };
            call.response.complete = false;
            call.response.write(Buffer.alloc(4, 1));
            setTimeout(() => call.response.destroy(), 5);
        });
        const downloader = new Downloader(fake);

        await assert.rejects(downloader.downloadAsset(URL, dest), /premature|close/i);
        assert.equal(fs.existsSync(dest), false);
    });

    it("rejects when the request closes before sending a response", async () => {
        const dir = tempDir();
        const dest = path.join(dir, "app.exe");
        const fake = createFakeRequest((call) => {
            setTimeout(() => call.request.destroy(), 5);
        }, false);
        const downloader = new Downloader(fake);

        await assert.rejects(
            downloader.downloadAsset(URL, dest),
            /closed before a response|premature/i
        );
        assert.equal(fs.existsSync(dest), false);
    });

    it("rejects when the destination stream cannot be written", async () => {
        const dir = tempDir();
        const dest = path.join(dir, "missing-subdir", "app.exe");
        const fake = createFakeRequest((call) => respondWith(call, "inert"));
        const downloader = new Downloader(fake);

        await assert.rejects(downloader.downloadAsset(URL, dest), /ENOENT/);
        assert.equal(fs.existsSync(dest), false);
    });

    it("rejects a partial body even when the stream ends without an error", async () => {
        const dir = tempDir();
        const dest = path.join(dir, "app.exe");
        const fake = createFakeRequest((call) => {
            call.response.statusCode = 200;
            call.response.headers = { "content-length": "100" };
            call.response.complete = true;
            call.response.end(Buffer.alloc(7, 1));
        });
        const downloader = new Downloader(fake);

        await assert.rejects(downloader.downloadAsset(URL, dest), /incomplete|premature/i);
        assert.equal(fs.existsSync(dest), false);
    });

    it("rejects a non-2xx response without leaving a file", async () => {
        const dir = tempDir();
        const dest = path.join(dir, "app.exe");
        const fake = createFakeRequest((call) => {
            call.response.statusCode = 404;
            call.response.headers = {};
            call.response.end("not found");
        });
        const downloader = new Downloader(fake);

        await assert.rejects(downloader.downloadAsset(URL, dest), /Failed to download: 404/);
        assert.equal(fs.existsSync(dest), false);
    });

    it("follows an absolute redirect and writes only the final body", async () => {
        const dir = tempDir();
        const dest = path.join(dir, "app.exe");
        const fake = createFakeRequest((call, index) => {
            if (index === 0) {
                call.response.statusCode = 302;
                call.response.headers = { location: "https://example.test/final.exe" };
                call.response.end();
            } else {
                respondWith(call, "final");
            }
        });
        const downloader = new Downloader(fake);

        const result = await downloader.downloadAsset(URL, dest);

        assert.equal(result, dest);
        assert.equal(fs.readFileSync(dest, "utf8"), "final");
        assert.equal(fake.calls.length, 2);
        assert.equal(fake.calls[1]?.url, "https://example.test/final.exe");
    });

    it("rejects an insecure redirect", async () => {
        const dir = tempDir();
        const dest = path.join(dir, "app.exe");
        const fake = createFakeRequest((call) => {
            call.response.statusCode = 302;
            call.response.headers = { location: "http://example.test/final.exe" };
            call.response.end();
        });
        const downloader = new Downloader(fake);

        await assert.rejects(downloader.downloadAsset(URL, dest), /insecure/i);
        assert.equal(fs.existsSync(dest), false);
    });

    it("rejects a SHA256 mismatch and removes the file", async () => {
        const dir = tempDir();
        const dest = path.join(dir, "app.exe");
        const fake = createFakeRequest((call) => respondWith(call, "inert"));
        const downloader = new Downloader(fake);

        await assert.rejects(
            downloader.downloadAsset(URL, dest, undefined, "00".repeat(32)),
            /SHA256 mismatch/
        );
        assert.equal(fs.existsSync(dest), false);
    });

    it("ignores a late request error after an abort instead of settling twice", async () => {
        const dir = tempDir();
        const dest = path.join(dir, "app.exe");
        const fake = createFakeRequest((call) => {
            call.response.statusCode = 200;
            call.response.headers = { "content-length": "100" };
            call.response.complete = false;
            call.response.write(Buffer.alloc(3, 1));
        });
        const downloader = new Downloader(fake);
        const controller = new AbortController();

        const promise = downloader.downloadAsset(URL, dest, undefined, undefined, {
            signal: controller.signal,
        });
        controller.abort();
        await assert.rejects(promise, (error: Error) => error.name === "AbortError");

        // A second settlement attempt (request error) must not produce an
        // unhandled error or a second rejection.
        const rejections: unknown[] = [];
        const tracked = promise.catch((error) => rejections.push(error));
        fake.calls[0]?.request.emit("error", new Error("late"));
        await delay(10);
        await tracked;
        assert.equal(rejections.length, 1);
    });

    it("lets a second attempt use the same path after the first times out", async () => {
        const dir = tempDir();
        const dest = path.join(dir, "app.exe");
        const fake = createFakeRequest((call, index) => {
            if (index === 0) {
                call.response.statusCode = 200;
                call.response.headers = { "content-length": "100" };
                call.response.complete = false;
                call.response.write(Buffer.alloc(9, 1));
                return;
            }
            respondWith(call, "second attempt");
        });
        const downloader = new Downloader(fake);

        await assert.rejects(
            downloader.downloadAsset(URL, dest, undefined, undefined, { timeoutMs: 20 }),
            (error: Error) => error.name === "TimeoutError"
        );
        assert.equal(fake.calls[0]?.request.destroyed, true);

        const result = await downloader.downloadAsset(URL, dest);
        assert.equal(result, dest);
        assert.equal(fs.readFileSync(dest, "utf8"), "second attempt");
        assert.equal(fake.calls.length, 2);
    });

    it("keeps the legacy four-argument behavior when no options are supplied", async () => {
        const dir = tempDir();
        const dest = path.join(dir, "app.exe");
        const fake = createFakeRequest((call) => respondWith(call, "legacy"));
        const downloader = new Downloader(fake);

        const result = await downloader.downloadAsset(URL, dest);
        assert.equal(result, dest);
        assert.equal(fs.existsSync(dest), true);
        assert.equal(fs.readFileSync(dest, "utf8"), "legacy");
    });
});
