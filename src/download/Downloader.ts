import * as https from "https";
import * as http from "http";
import * as fs from "fs";
import * as crypto from "crypto";
import { Writable } from "stream";
import { pipeline } from "stream/promises";
import { validateGpgSignature } from "./validators/gpg";
import type { UpdateOptions } from "../types";
import {
    abortErrorFromSignal,
    createAbortContext,
    createTimeoutError,
    toError,
} from "../utils/abort";
import {
    DownloadPolicy,
    validateDownloadUrl,
} from "./urlPolicy";
import { UpdateSecurityError } from "../security/errors";

export type { DownloadPolicy } from "./urlPolicy";

export interface DownloadProgress {
    percent: number;
    transferred: number;
    total: number;
}

export interface DownloadRequestOptions {
    signal?: AbortSignal;
    timeoutMs?: number;
}

export interface DownloadRequestHandle {
    on(event: "error", listener: (error: Error) => void): this;
    on(event: "close", listener: () => void): this;
    destroy(error?: Error): this;
    setTimeout?(timeoutMs: number, callback: () => void): this;
}

/**
 * Minimal seam around `https.get` so download behavior can be exercised with
 * fake streams in tests. Not part of the package's public API.
 */
export type DownloadRequest = (
    url: string,
    options: DownloadRequestOptions,
    onResponse: (response: http.IncomingMessage) => void
) => DownloadRequestHandle;

const defaultRequest: DownloadRequest = (url, options, onResponse) =>
    https.get(url, { signal: options.signal }, onResponse);

const MAX_REDIRECTS = 5;
const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308]);

async function removeFile(filePath: string): Promise<void> {
    try {
        await fs.promises.rm(filePath, { force: true });
    } catch {
        // Best effort: the original error is more useful than a cleanup error.
    }
}

function headerValue(
    value: string | string[] | undefined
): string | undefined {
    return Array.isArray(value) ? value[0] : value;
}

function parseContentLength(value: string | string[] | undefined): number {
    const parsed = Number.parseInt(headerValue(value) ?? "", 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

/**
 * Downloader handles secure asset downloads, SHA256, and GPG validation.
 * Used internally by Updater.
 */
export class Downloader {
    constructor(private readonly request: DownloadRequest = defaultRequest) {}

    /**
     * Downloads an asset to the given path, with optional progress, SHA256
     * validation and cancellation.
     *
     * On every failure the destination file is removed, open streams are
     * destroyed and the returned promise settles exactly once.
     *
     * @param assetUrl URL to download (https only)
     * @param destPath Local file path to save
     * @param onProgress Optional progress callback
     * @param expectedSha256 Optional SHA256 hash to validate
     * @param options Optional abort signal and timeout
     * @returns Path to downloaded file
     * @throws Error named `AbortError` on caller cancellation, `TimeoutError`
     * on timeout, or a descriptive Error for transport/validation failures
     */
    async downloadAsset(
        assetUrl: string,
        destPath: string,
        onProgress?: (progress: DownloadProgress) => void,
        expectedSha256?: string,
        options?: UpdateOptions,
        policy?: DownloadPolicy
    ): Promise<string> {
        const context = createAbortContext(options);
        const state = { touched: false };
        try {
            await this.downloadToPath(
                assetUrl,
                destPath,
                onProgress,
                expectedSha256,
                context.signal,
                state,
                policy
            );
            if (context.signal?.aborted) {
                throw abortErrorFromSignal(context.signal);
            }
            return destPath;
        } catch (error) {
            if (state.touched) {
                await removeFile(destPath);
            }
            if (context.signal?.aborted) {
                throw abortErrorFromSignal(context.signal);
            }
            throw toError(error);
        } finally {
            context.cleanup();
        }
    }

    /**
     * Validates a file's SHA256 hash.
     * @param filePath Path to file
     * @param expected Expected SHA256 hash
     * @param options Optional abort signal and timeout
     * @throws Error if hash does not match or the operation is cancelled
     */
    async validateSha256(
        filePath: string,
        expected: string,
        options?: UpdateOptions
    ): Promise<void> {
        const context = createAbortContext(options);
        try {
            const hash = crypto.createHash("sha256");
            const sink = new Writable({
                write(chunk: Buffer, _encoding, callback): void {
                    hash.update(chunk);
                    callback();
                },
            });
            const source = fs.createReadStream(filePath);
            if (context.signal) {
                await pipeline(source, sink, { signal: context.signal });
            } else {
                await pipeline(source, sink);
            }
            if (context.signal?.aborted) {
                throw abortErrorFromSignal(context.signal);
            }
            const digest = hash.digest("hex");
            if (digest.toLowerCase() !== expected.toLowerCase()) {
                throw new Error(
                    `SHA256 mismatch: expected ${expected}, got ${digest}`
                );
            }
        } catch (error) {
            if (context.signal?.aborted) {
                throw abortErrorFromSignal(context.signal);
            }
            throw toError(error);
        } finally {
            context.cleanup();
        }
    }

    /**
     * Validates a file's GPG signature using a detached .sig file.
     * @param filePath Path to file
     * @param sigPath Path to .sig file
     * @param keyringPath Optional keyring
     * @param options Optional abort signal and timeout
     * @throws Error if signature is invalid or the operation is cancelled
     */
    async validateGpg(
        filePath: string,
        sigPath: string,
        keyringPath?: string,
        options?: UpdateOptions
    ): Promise<void> {
        await validateGpgSignature(filePath, sigPath, keyringPath, options);
    }

    private async downloadToPath(
        assetUrl: string,
        destPath: string,
        onProgress: ((progress: DownloadProgress) => void) | undefined,
        expectedSha256: string | undefined,
        signal: AbortSignal | undefined,
        state: { touched: boolean },
        policy: DownloadPolicy | undefined
    ): Promise<void> {
        let currentUrl: string = validateDownloadUrl(assetUrl, policy).toString();
        let redirects = 0;

        for (;;) {
            if (signal?.aborted) throw abortErrorFromSignal(signal);

            const { response, request } = await this.requestResponse(
                currentUrl,
                signal,
                policy
            );
            const status = response.statusCode ?? 0;
            const location = headerValue(response.headers.location);

            if (REDIRECT_STATUS.has(status)) {
                response.on("error", () => undefined);
                response.resume();
                if (!location) {
                    throw new Error("Redirect without location header");
                }
                const next = validateDownloadUrl(location, policy, currentUrl);
                redirects += 1;
                if (redirects > MAX_REDIRECTS) {
                    throw new Error("Too many redirects");
                }
                currentUrl = next.toString();
                continue;
            }

            if (status !== 200) {
                response.on("error", () => undefined);
                response.destroy();
                throw new Error(`Failed to download: ${status}`);
            }

            await this.writeResponse(
                response,
                request,
                destPath,
                onProgress,
                expectedSha256,
                signal,
                state,
                policy
            );
            return;
        }
    }

    /**
     * Starts one request and resolves with its response. Rejects on request
     * errors or abort even if the underlying request implementation ignores
     * the signal.
     */
    private requestResponse(
        url: string,
        signal: AbortSignal | undefined,
        policy: DownloadPolicy | undefined
    ): Promise<{
        response: http.IncomingMessage;
        request: DownloadRequestHandle;
    }> {
        if (signal?.aborted) {
            return Promise.reject(abortErrorFromSignal(signal));
        }

        return new Promise((resolve, reject) => {
            let settled = false;
            let response: http.IncomingMessage | undefined;
            let request: DownloadRequestHandle | undefined;

            const finish = (settle: () => void): void => {
                if (settled) return;
                settled = true;
                signal?.removeEventListener("abort", onAbort);
                settle();
            };

            const onAbort = (): void => {
                const reason = abortErrorFromSignal(signal);
                request?.destroy(reason);
                finish(() => reject(reason));
            };

            try {
                request = this.request(url, { signal }, (incoming) => {
                    if (settled) {
                        incoming.destroy();
                        return;
                    }
                    response = incoming;
                    finish(() => {
                        if (request) {
                            resolve({ response: incoming, request });
                        } else {
                            incoming.destroy();
                            reject(new Error("Request was not created"));
                        }
                    });
                });
            } catch (error) {
                finish(() => reject(toError(error)));
                return;
            }

            request.on("error", (error) => {
                if (!settled) {
                    finish(() => reject(error));
                } else if (response && !response.destroyed) {
                    // Late transport errors still need to reach the pipeline.
                    response.destroy(error);
                }
            });

            request.on("close", () => {
                if (!settled) {
                    finish(() =>
                        reject(
                            new Error(
                                "Request closed before a response was received"
                            )
                        )
                    );
                }
            });

            if (policy?.requestTimeoutMs && request.setTimeout) {
                request.setTimeout(policy.requestTimeoutMs, () => {
                    const timeout = createTimeoutError(policy.requestTimeoutMs!);
                    request?.destroy(timeout);
                    finish(() => reject(timeout));
                });
            }

            if (signal) {
                signal.addEventListener("abort", onAbort, { once: true });
                if (signal.aborted) onAbort();
            }
        });
    }

    private async writeResponse(
        response: http.IncomingMessage,
        request: DownloadRequestHandle,
        destPath: string,
        onProgress: ((progress: DownloadProgress) => void) | undefined,
        expectedSha256: string | undefined,
        signal: AbortSignal | undefined,
        state: { touched: boolean },
        policy: DownloadPolicy | undefined
    ): Promise<void> {
        const maxBytes = policy?.maxBytes;
        const declaredLength = parseContentLength(
            response.headers["content-length"]
        );
        if (maxBytes !== undefined && declaredLength > maxBytes) {
            response.on("error", () => undefined);
            response.destroy();
            throw new UpdateSecurityError(
                "SIZE_MISMATCH",
                `Download exceeds the configured maximum size of ${maxBytes} bytes`
            );
        }

        // A stale file from an earlier attempt must never be mistaken for this
        // attempt's bytes; exclusive creation catches concurrent writers.
        await fs.promises.rm(destPath, { force: true });
        state.touched = true;
        const file = fs.createWriteStream(destPath, { flags: "wx" });
        const total = parseContentLength(response.headers["content-length"]);
        let transferred = 0;

        const onAbort = (): void => {
            request.destroy(abortErrorFromSignal(signal));
        };
        signal?.addEventListener("abort", onAbort, { once: true });
        if (signal?.aborted) onAbort();

        if (policy?.requestTimeoutMs && typeof response.setTimeout === "function") {
            response.setTimeout(policy.requestTimeoutMs, () => {
                response.destroy(createTimeoutError(policy.requestTimeoutMs!));
            });
        }
        const onData = (chunk: Buffer): void => {
            transferred += chunk.length;
            if (maxBytes !== undefined && transferred > maxBytes) {
                response.destroy(
                    new UpdateSecurityError(
                        "SIZE_MISMATCH",
                        `Download exceeds the configured maximum size of ${maxBytes} bytes`
                    )
                );
                return;
            }
            if (onProgress && total > 0) {
                try {
                    onProgress({
                        percent: (transferred / total) * 100,
                        transferred,
                        total,
                    });
                } catch (error) {
                    response.destroy(toError(error));
                }
            }
        };
        response.on("data", onData);

        try {
            if (signal) {
                await pipeline(response, file, { signal });
            } else {
                await pipeline(response, file);
            }
        } finally {
            signal?.removeEventListener("abort", onAbort);
            response.off("data", onData);
        }

        if (signal?.aborted) {
            throw abortErrorFromSignal(signal);
        }
        if (response.complete === false) {
            throw new Error("Download ended prematurely");
        }
        if (total > 0 && transferred !== total) {
            throw new Error(
                `Incomplete download: expected ${total} bytes, received ${transferred}`
            );
        }
        if (maxBytes !== undefined && transferred > maxBytes) {
            throw new UpdateSecurityError(
                "SIZE_MISMATCH",
                `Download exceeds the configured maximum size of ${maxBytes} bytes`
            );
        }
        if (expectedSha256) {
            await this.validateSha256(
                destPath,
                expectedSha256,
                signal ? { signal } : undefined
            );
        }
    }
}
