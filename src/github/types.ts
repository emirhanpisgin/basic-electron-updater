import { UpdateInfo } from "../types";

export interface GitHubReleaseAsset {
    name: string;
    browser_download_url: string;
    size: number;
    sha256?: string;
    gpgSignatureUrl?: string;
}

export interface GitHubRelease {
    tag_name: string;
    name: string;
    body: string;
    prerelease: boolean;
    draft: boolean;
    assets: GitHubReleaseAsset[];
    published_at: string;
}

/** Minimal fetch shape used by the provider; tests inject a fake. */
export type FetchLike = (
    input: string,
    init?: {
        headers?: Record<string, string>;
        signal?: AbortSignal;
    }
) => Promise<{
    ok: boolean;
    status: number;
    statusText: string;
    text(): Promise<string>;
    json(): Promise<unknown>;
}>;

export interface GitHubProviderOptions {
    repo: string;
    allowPrerelease?: boolean;
    channel?: string;
    /** @internal Test seam; defaults to the global fetch. */
    fetchImpl?: FetchLike;
}

export type GitHubReleaseResult = UpdateInfo | null;
