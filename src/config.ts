import { UpdaterConfig } from "./types";
import { defaultLogger } from "./utils/logger";
import { normalizeAssetPolicy } from "./assets/selectAsset";
import {
    ResolvedSecurityOptions,
    resolveSecurityOptions,
} from "./security/config";

export type ResolvedUpdaterConfig = Required<Omit<UpdaterConfig, "security">> & {
    security: ResolvedSecurityOptions;
};

export function resolveConfig(userConfig: UpdaterConfig): ResolvedUpdaterConfig {
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
        security: resolveSecurityOptions(userConfig.security, userConfig.repo),
    };
}
