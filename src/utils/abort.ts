import type { UpdateOptions } from "../types";

export interface AbortContext {
    /** Undefined when the caller supplied neither a signal nor a timeout. */
    signal: AbortSignal | undefined;
    cleanup(): void;
}

/**
 * Combines an optional external AbortSignal with an optional timeout into one
 * signal. Without either option the returned signal stays undefined so the
 * legacy fetch/download path is unchanged.
 */
export function createAbortContext(options?: UpdateOptions): AbortContext {
    const external = options?.signal;
    const timeoutMs = options?.timeoutMs;

    if (timeoutMs !== undefined) {
        if (typeof timeoutMs !== "number" || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
            throw new RangeError("timeoutMs must be a positive finite number");
        }
    }

    if (!external && timeoutMs === undefined) {
        return { signal: undefined, cleanup: () => undefined };
    }

    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;

    const onAbort = (): void => {
        if (timer !== undefined) {
            clearTimeout(timer);
            timer = undefined;
        }
        controller.abort(abortErrorFromReason(external?.reason));
    };

    if (external) {
        if (external.aborted) {
            onAbort();
        } else {
            external.addEventListener("abort", onAbort, { once: true });
        }
    }

    if (timeoutMs !== undefined && !controller.signal.aborted) {
        timer = setTimeout(() => {
            timer = undefined;
            controller.abort(createTimeoutError(timeoutMs));
        }, timeoutMs);
    }

    return {
        signal: controller.signal,
        cleanup(): void {
            if (timer !== undefined) {
                clearTimeout(timer);
                timer = undefined;
            }
            external?.removeEventListener("abort", onAbort);
        },
    };
}

export function createTimeoutError(timeoutMs: number): Error {
    const error = new Error(`Update operation timed out after ${timeoutMs}ms`);
    error.name = "TimeoutError";
    return error;
}

export function createAbortError(reason?: unknown): Error {
    const error = new Error("The update operation was aborted", { cause: reason });
    error.name = "AbortError";
    return error;
}

/** Returns the signal's reason as an Error, or a fresh AbortError. */
export function abortErrorFromSignal(signal?: AbortSignal): Error {
    if (signal?.aborted) {
        return abortErrorFromReason(signal.reason);
    }
    return createAbortError();
}

function abortErrorFromReason(reason: unknown): Error {
    if (reason instanceof Error) return reason;
    if (
        reason !== null &&
        typeof reason === "object" &&
        "name" in reason &&
        typeof (reason as { name?: unknown }).name === "string"
    ) {
        return reason as Error;
    }
    return createAbortError(reason);
}

export function isAbortError(error: unknown): boolean {
    return (
        error instanceof Error &&
        error.name === "AbortError"
    );
}

export function isTimeoutError(error: unknown): boolean {
    return (
        error instanceof Error &&
        error.name === "TimeoutError"
    );
}

export function isAbortLike(error: unknown): boolean {
    return isAbortError(error) || isTimeoutError(error);
}

export function toError(error: unknown): Error {
    return error instanceof Error ? error : new Error(String(error));
}
