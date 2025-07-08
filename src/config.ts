import { UpdaterConfig } from "./types";
import { defaultLogger } from "./utils/logger";

export function resolveConfig(userConfig: UpdaterConfig): Required<UpdaterConfig> {
    // Validate repo format (should be "owner/repo")
    if (!userConfig.repo || !userConfig.repo.includes('/') || userConfig.repo.split('/').length !== 2) {
        throw new Error('Invalid repository format. Expected "owner/repo"');
    }
    
    return {
        autoDownload: true,
        allowPrerelease: false,
        channel: "latest",
        logger: defaultLogger,
        debug: userConfig.debug ?? false,
        ...userConfig,
    };
}
