import * as https from "https";
import * as fs from "fs";
import * as crypto from "crypto";
import { UpdateInfo } from "../types";
import { validateGpgSignature } from "./validators/gpg";

export interface DownloadProgress {
    percent: number;
    transferred: number;
    total: number;
}

/**
 * Downloader handles secure asset downloads, SHA256, and GPG validation.
 * Used internally by Updater.
 */
export class Downloader {
    /**
     * Downloads an asset to the given path, with optional progress and SHA256 validation.
     * @param assetUrl URL to download
     * @param destPath Local file path to save
     * @param onProgress Optional progress callback
     * @param expectedSha256 Optional SHA256 hash to validate
     * @returns Path to downloaded file
     * @throws Error if download or hash validation fails
     */
    async downloadAsset(
        assetUrl: string,
        destPath: string,
        onProgress?: (progress: DownloadProgress) => void,
        expectedSha256?: string
    ): Promise<string> {
        return new Promise((resolve, reject) => {
            const file = fs.createWriteStream(destPath);
            https.get(assetUrl, res => {
                if (res.statusCode !== 200) {
                    return reject(new Error(`Failed to download: ${res.statusCode}`));
                }
                const total = parseInt(res.headers["content-length"] || "0", 10);
                let transferred = 0;
                res.on("data", chunk => {
                    transferred += chunk.length;
                    if (onProgress && total) {
                        onProgress({
                            percent: total ? transferred / total : 0,
                            transferred,
                            total,
                        });
                    }
                });
                res.pipe(file);
                file.on("finish", async () => {
                    file.close(async () => {
                        if (expectedSha256) {
                            try {
                                await this.validateSha256(destPath, expectedSha256);
                                resolve(destPath);
                            } catch (err) {
                                fs.unlink(destPath, () => reject(err));
                            }
                        } else {
                            resolve(destPath);
                        }
                    });
                });
            }).on("error", err => {
                fs.unlink(destPath, () => reject(err));
            });
        });
    }

    /**
     * Validates a file's SHA256 hash.
     * @param filePath Path to file
     * @param expected Expected SHA256 hash
     * @throws Error if hash does not match
     */
    async validateSha256(filePath: string, expected: string): Promise<void> {
        return new Promise((resolve, reject) => {
            const hash = crypto.createHash("sha256");
            const stream = fs.createReadStream(filePath);
            stream.on("data", chunk => hash.update(chunk));
            stream.on("end", () => {
                const digest = hash.digest("hex");
                if (digest.toLowerCase() !== expected.toLowerCase()) {
                    reject(new Error(`SHA256 mismatch: expected ${expected}, got ${digest}`));
                } else {
                    resolve();
                }
            });
            stream.on("error", reject);
        });
    }

    /**
     * Validates a file's GPG signature using a detached .sig file.
     * @param filePath Path to file
     * @param sigPath Path to .sig file
     * @param keyringPath Optional keyring
     * @throws Error if signature is invalid
     */
    async validateGpg(filePath: string, sigPath: string, keyringPath?: string): Promise<void> {
        await validateGpgSignature(filePath, sigPath, keyringPath);
    }

    // Optionally: add hash/signature validation methods here
}
