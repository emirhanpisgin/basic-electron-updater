import * as fs from "fs";
import { spawn } from "child_process";

/**
 * Validates a file's GPG signature using a detached .sig file and a public keyring.
 * Throws if validation fails.
 */
export async function validateGpgSignature(
    filePath: string,
    sigPath: string,
    keyringPath?: string
): Promise<void> {
    return new Promise((resolve, reject) => {
        const args = ["--verify", sigPath, filePath];
        if (keyringPath) {
            args.unshift("--keyring", keyringPath);
        }
        const proc = spawn("gpg", args);
        let stderr = "";
        proc.stderr.on("data", d => (stderr += d.toString()));
        proc.on("close", code => {
            if (code === 0) {
                resolve();
            } else {
                reject(new Error(`GPG signature validation failed: ${stderr}`));
            }
        });
        proc.on("error", reject);
    });
}
