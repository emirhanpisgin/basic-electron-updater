import { UpdaterConfig } from "./types";
import { defaultLogger } from "./utils/logger";

export function resolveConfig(userConfig: UpdaterConfig): Required<UpdaterConfig> {
    return {
        autoDownload: true,
        allowPrerelease: false,
        channel: "latest",
        logger: defaultLogger,
        ...userConfig,
    };
}
