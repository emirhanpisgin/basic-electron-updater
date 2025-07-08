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

export interface GitHubProviderOptions {
    repo: string;
    allowPrerelease?: boolean;
    channel?: string;
}

export type GitHubReleaseResult = UpdateInfo | null;
