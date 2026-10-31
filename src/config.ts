import { UpdaterConfig } from "./types";
import { defaultLogger } from "./utils/logger";
import { normalizeAssetPolicy } from "./assets/selectAsset";

export function resolveConfig(userConfig: UpdaterConfig): Required<UpdaterConfig> {
    // Validate repo format (should be "owner/repo")
    if (!userConfig.repo || !userConfig.repo.includes('/') || userConfig.repo.split('/').length !== 2) {
        throw new Error('Invalid repository format. Expected "owner/repo"');
    }

    const repoName = userConfig.repo.split("/")[1];

    return {
        autoDownload: true,
        allowPrerelease: false,
        channel: "latest",
        logger: defaultLogger,
        debug: userConfig.debug ?? false,
        ...userConfig,
        assetPolicy: normalizeAssetPolicy(userConfig.assetPolicy, repoName),
    };
}
