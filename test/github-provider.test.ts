import { describe, it } from "mocha";
import * as assert from "assert";
import { GitHubProvider } from "../src/github/GitHubProvider";
import type { FetchLike } from "../src/github/GitHubProvider";

interface FetchCall {
    url: string;
    init: { signal?: AbortSignal; headers?: Record<string, string> };
}

function releasePayload(): unknown {
    return [
        {
            tag_name: "v1.0.7",
            name: "1.0.7",
            body: "",
            prerelease: false,
            draft: false,
            published_at: "2026-10-30T00:00:00Z",
            assets: [
                {
                    name: "Melodify Setup.exe",
                    browser_download_url: "https://example.test/setup.exe",
                    size: 12,
                },
            ],
        },
    ];
}

function fakeFetch(onCall?: (init: { signal?: AbortSignal }) => void): { fetch: FetchLike; calls: FetchCall[] } {
    const calls: FetchCall[] = [];
    const fetch = async (
        url: string,
        init?: { signal?: AbortSignal; headers?: Record<string, string> }
    ): Promise<Response> => {
        calls.push({ url, init: init ?? {} });
        onCall?.(init ?? {});
        return {
            ok: true,
            status: 200,
            statusText: "OK",
            text: async () => "",
            json: async () => releasePayload(),
        } as unknown as Response;
    };
    return { fetch, calls };
}

describe("GitHubProvider cancellation", () => {
    it("passes an abort signal into fetch and still resolves release data", async () => {
        const { fetch, calls } = fakeFetch();
        const provider = new GitHubProvider({ repo: "owner/repo", fetchImpl: fetch });
        const controller = new AbortController();

        const result = await provider.getLatestRelease({ signal: controller.signal });

        assert.equal(result?.version, "v1.0.7");
        assert.equal(calls.length, 1);
        assert.equal(calls[0]?.init.signal instanceof AbortSignal, true);
        assert.equal(calls[0]?.init.signal?.aborted, false);
    });

    it("rejects with AbortError when the caller aborts the fetch", async () => {
        const controller = new AbortController();
        const fetch: FetchLike = (_url, init) =>
            new Promise((_resolve, reject) => {
                init?.signal?.addEventListener("abort", () =>
                    reject(init.signal?.reason)
                );
            });
        const provider = new GitHubProvider({ repo: "owner/repo", fetchImpl: fetch });

        const pending = provider.getLatestRelease({ signal: controller.signal });
        setTimeout(() => controller.abort(), 5);

        await assert.rejects(pending, (error: Error) => error.name === "AbortError");
    });

    it("rejects with TimeoutError when the fetch exceeds the timeout", async () => {
        const fetch: FetchLike = (_url, init) =>
            new Promise((_resolve, reject) => {
                init?.signal?.addEventListener("abort", () =>
                    reject(init.signal?.reason)
                );
            });
        const provider = new GitHubProvider({ repo: "owner/repo", fetchImpl: fetch });

        await assert.rejects(
            provider.getLatestRelease({ timeoutMs: 20 }),
            (error: Error) => error.name === "TimeoutError"
        );
    });

    it("keeps wrapping ordinary network failures", async () => {
        const fetch = async (): Promise<Response> => {
            throw new Error("socket closed");
        };
        const provider = new GitHubProvider({ repo: "owner/repo", fetchImpl: fetch as FetchLike });

        await assert.rejects(provider.getLatestRelease(), /Network error accessing GitHub API/);
    });

    it("keeps the no-options request unchanged", async () => {
        const { fetch, calls } = fakeFetch();
        const provider = new GitHubProvider({ repo: "owner/repo", fetchImpl: fetch });

        const result = await provider.getLatestRelease();

        assert.equal(result?.version, "v1.0.7");
        assert.equal(calls[0]?.init.signal, undefined);
    });

    it("maps GitHub digest/size and selects the greatest semantic version", async () => {
        const digest = "a".repeat(64);
        const payload = [
            {
                tag_name: "v1.0.9",
                name: "old",
                body: "",
                prerelease: false,
                draft: false,
                published_at: "2026-01-01T00:00:00Z",
                assets: [
                    {
                        name: "old.exe",
                        browser_download_url: "https://example.test/old.exe",
                        size: 1,
                        digest: null,
                    },
                ],
            },
            {
                tag_name: "v1.2.0",
                name: "new",
                body: "",
                prerelease: false,
                draft: false,
                published_at: "2026-02-01T00:00:00Z",
                assets: [
                    {
                        name: "new.exe",
                        browser_download_url: "https://example.test/new.exe",
                        size: 123,
                        digest: `sha256:${digest}`,
                    },
                ],
            },
        ];
        const fetch = async (): Promise<Response> =>
            ({
                ok: true,
                status: 200,
                statusText: "OK",
                text: async () => "",
                json: async () => payload,
            }) as unknown as Response;
        const provider = new GitHubProvider({
            repo: "owner/repo",
            fetchImpl: fetch as FetchLike,
        });

        const result = await provider.getLatestRelease();

        assert.equal(result?.version, "v1.2.0");
        assert.equal(result?.assets[0].size, 123);
        assert.equal(result?.assets[0].sha256, digest);
    });

    it("respects allowPrerelease without changing version validation", async () => {
        const payload = [
            {
                tag_name: "v1.3.0-beta.1",
                name: "beta",
                body: "",
                prerelease: true,
                draft: false,
                published_at: "2026-03-01T00:00:00Z",
                assets: [],
            },
            {
                tag_name: "v1.2.0",
                name: "stable",
                body: "",
                prerelease: false,
                draft: false,
                published_at: "2026-02-01T00:00:00Z",
                assets: [],
            },
        ];
        const fetch = async (): Promise<Response> =>
            ({
                ok: true,
                status: 200,
                statusText: "OK",
                text: async () => "",
                json: async () => payload,
            }) as unknown as Response;

        const stable = await new GitHubProvider({
            repo: "owner/repo",
            allowPrerelease: false,
            fetchImpl: fetch as FetchLike,
        }).getLatestRelease();
        const prerelease = await new GitHubProvider({
            repo: "owner/repo",
            allowPrerelease: true,
            fetchImpl: fetch as FetchLike,
        }).getLatestRelease();

        assert.equal(stable?.version, "v1.2.0");
        assert.equal(prerelease?.version, "v1.3.0-beta.1");
    });
});
