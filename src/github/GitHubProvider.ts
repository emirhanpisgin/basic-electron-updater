import { GitHubProviderOptions, GitHubRelease, GitHubReleaseResult } from "./types";
import { UpdateInfo } from "../types";

/**
 * GitHubProvider fetches release data from the GitHub API for the configured repo.
 * Used internally by Updater.
 */
export class GitHubProvider {
    private repo: string;
    private allowPrerelease: boolean;
    private channel: string;

    /**
     * Create a new GitHubProvider.
     * @param options GitHub provider options
     */
    constructor(options: GitHubProviderOptions) {
        this.repo = options.repo;
        this.allowPrerelease = options.allowPrerelease ?? false;
        this.channel = options.channel ?? "latest";
    }

    /**
     * Fetches the latest release matching the config (channel, prerelease, etc).
     * @returns UpdateInfo if available, otherwise null
     * @throws Error if the GitHub API request fails
     */
    async getLatestRelease(): Promise<GitHubReleaseResult> {
        const url = `https://api.github.com/repos/${this.repo}/releases`;
        
        let res: Response;
        try {
            res = await fetch(url, {
                headers: { 
                    Accept: "application/vnd.github+json",
                    "User-Agent": "basic-electron-updater"
                },
            });
        } catch (error) {
            throw new Error(`Network error accessing GitHub API: ${error instanceof Error ? error.message : String(error)}`);
        }
        
        if (!res.ok) {
            const errorText = await res.text().catch(() => 'Unknown error');
            throw new Error(`GitHub API error: ${res.status} ${res.statusText} - ${errorText}`);
        }
        
        let releases: GitHubRelease[];
        try {
            releases = await res.json();
        } catch (error) {
            throw new Error(`Invalid JSON response from GitHub API: ${error instanceof Error ? error.message : String(error)}`);
        }
        
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
    }
}
