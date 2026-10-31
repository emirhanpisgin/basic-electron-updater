import {
    FetchLike,
    GitHubProviderOptions,
    GitHubRelease,
    GitHubReleaseResult,
} from "./types";
import type { UpdateOptions } from "../types";
import {
    abortErrorFromSignal,
    createAbortContext,
    toError,
} from "../utils/abort";

export type { FetchLike } from "./types";

/**
 * GitHubProvider fetches release data from the GitHub API for the configured repo.
 * Used internally by Updater.
 */
export class GitHubProvider {
    private repo: string;
    private allowPrerelease: boolean;
    private channel: string;
    private fetchImpl: FetchLike;

    /**
     * Create a new GitHubProvider.
     * @param options GitHub provider options
     */
    constructor(options: GitHubProviderOptions) {
        this.repo = options.repo;
        this.allowPrerelease = options.allowPrerelease ?? false;
        this.channel = options.channel ?? "latest";
        this.fetchImpl = options.fetchImpl ?? fetch;
    }

    /**
     * Fetches the latest release matching the config (channel, prerelease, etc).
     * @returns GitHubReleaseResult if available, otherwise null
     * @throws Error if the GitHub API request fails, or an `AbortError` /
     * `TimeoutError` when the operation is cancelled
     */
    async getLatestRelease(options?: UpdateOptions): Promise<GitHubReleaseResult> {
        const context = createAbortContext(options);
        const signal = context.signal;
        const url = `https://api.github.com/repos/${this.repo}/releases`;

        try {
            if (signal?.aborted) throw abortErrorFromSignal(signal);

            let res: Awaited<ReturnType<FetchLike>>;
            try {
                const request = this.fetchImpl(url, {
                    headers: {
                        Accept: "application/vnd.github+json",
                        "User-Agent": "basic-electron-updater",
                    },
                    ...(signal ? { signal } : {}),
                });
                if (signal) {
                    let onAbort: (() => void) | undefined;
                    const aborted = new Promise<never>((_resolve, reject) => {
                        onAbort = (): void => reject(abortErrorFromSignal(signal));
                        if (signal.aborted) {
                            onAbort();
                        } else {
                            signal.addEventListener("abort", onAbort, { once: true });
                        }
                    });
                    try {
                        res = await Promise.race([request, aborted]);
                    } finally {
                        if (onAbort) {
                            signal.removeEventListener("abort", onAbort);
                        }
                    }
                } else {
                    res = await request;
                }
            } catch (error) {
                if (signal?.aborted) throw abortErrorFromSignal(signal);
                throw new Error(
                    `Network error accessing GitHub API: ${
                        error instanceof Error ? error.message : String(error)
                    }`
                );
            }

            if (signal?.aborted) throw abortErrorFromSignal(signal);

            if (!res.ok) {
                const errorText = await res.text().catch(() => "Unknown error");
                if (signal?.aborted) throw abortErrorFromSignal(signal);
                throw new Error(
                    `GitHub API error: ${res.status} ${res.statusText} - ${errorText}`
                );
            }

            let releases: GitHubRelease[];
            try {
                releases = (await res.json()) as GitHubRelease[];
            } catch (error) {
                throw new Error(
                    `Invalid JSON response from GitHub API: ${
                        error instanceof Error ? error.message : String(error)
                    }`
                );
            }

            if (signal?.aborted) throw abortErrorFromSignal(signal);

            if (!Array.isArray(releases)) {
                throw new Error("GitHub API returned invalid data format");
            }
            const filtered = releases.filter(
                (r) =>
                    !r.draft &&
                    (this.allowPrerelease || !r.prerelease) &&
                    (this.channel === "latest" || r.tag_name.includes(this.channel))
            );
            if (!filtered.length) return null;
            const release = filtered[0];
            return {
                version: release.tag_name,
                releaseName: release.name,
                releaseNotes: release.body,
                assets: release.assets.map((a) => ({
                    name: a.name,
                    url: a.browser_download_url,
                    sha256: a.sha256,
                    gpgSignatureUrl: a.gpgSignatureUrl,
                })),
            };
        } catch (error) {
            if (signal?.aborted) throw abortErrorFromSignal(signal);
            throw toError(error);
        } finally {
            context.cleanup();
        }
    }
}
