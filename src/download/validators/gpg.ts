import { spawn } from "child_process";
import type { UpdateOptions } from "../../types";
import {
    abortErrorFromSignal,
    createAbortContext,
} from "../../utils/abort";

/**
 * Validates a file's GPG signature using a detached .sig file and a public keyring.
 * Throws if validation fails or the operation is cancelled.
 */
export async function validateGpgSignature(
    filePath: string,
    sigPath: string,
    keyringPath?: string,
    options?: UpdateOptions
): Promise<void> {
    const context = createAbortContext(options);
    if (context.signal?.aborted) {
        context.cleanup();
        throw abortErrorFromSignal(context.signal);
    }

    return new Promise((resolve, reject) => {
        let settled = false;
        const args = ["--verify", sigPath, filePath];
        if (keyringPath) {
            args.unshift("--keyring", keyringPath);
        }

        const finish = (settle: () => void): void => {
            if (settled) return;
            settled = true;
            context.signal?.removeEventListener("abort", onAbort);
            context.cleanup();
            settle();
        };

        const proc = spawn("gpg", args);
        let stderr = "";

        const onAbort = (): void => {
            proc.kill();
            finish(() => reject(abortErrorFromSignal(context.signal)));
        };

        context.signal?.addEventListener("abort", onAbort, { once: true });
        if (context.signal?.aborted) onAbort();

        proc.stderr.on("data", (data) => (stderr += data.toString()));
        proc.on("close", (code) => {
            if (code === 0) {
                finish(resolve);
            } else {
                finish(() =>
                    reject(
                        new Error(`GPG signature validation failed: ${stderr}`)
                    )
                );
            }
        });
        proc.on("error", (error) => finish(() => reject(error)));
    });
}
