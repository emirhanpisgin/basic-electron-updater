import { EventEmitter } from "node:events";
import type { IncomingMessage } from "node:http";
import { PassThrough } from "node:stream";

/** Response stream with the small IncomingMessage surface the downloader reads. */
export interface FakeResponse extends PassThrough {
    statusCode?: number;
    headers: Record<string, string | string[] | undefined>;
    complete?: boolean;
}

export class FakeClientRequest extends EventEmitter {
    destroyed = false;

    setTimeout(timeoutMs: number, callback: () => void): this {
        setTimeout(callback, timeoutMs);
        return this;
    }

    destroy(error?: Error): this {
        if (this.destroyed) return this;
        this.destroyed = true;
        if (error) this.emit("error", error);
        this.emit("close");
        return this;
    }
}

export interface FakeRequestCall {
    url: string;
    options: { signal?: AbortSignal } | undefined;
    response: FakeResponse;
    request: FakeClientRequest;
}

export interface FakeRequest {
    (
        url: string,
        options: { signal?: AbortSignal } | undefined,
        onResponse: (response: IncomingMessage) => void
    ): FakeClientRequest;
    calls: FakeRequestCall[];
}

/**
 * Creates a fake `https.get`-shaped function. The handler runs once per call
 * and may write to `call.response`; the response callback is delivered on the
 * next microtask, like a real request.
 */
export function createFakeRequest(
    handler?: (call: FakeRequestCall, index: number) => void,
    autoRespond = true
): FakeRequest {
    const calls: FakeRequestCall[] = [];
    const request = ((
        url: string,
        options: { signal?: AbortSignal } | undefined,
        onResponse: (response: IncomingMessage) => void
    ): FakeClientRequest => {
        const response = new PassThrough() as FakeResponse;
        response.statusCode = 200;
        response.headers = {};
        response.complete = true;
        const fakeRequest = new FakeClientRequest();
        const call: FakeRequestCall = { url, options, response, request: fakeRequest };
        calls.push(call);
        if (autoRespond) {
            queueMicrotask(() => onResponse(response as unknown as IncomingMessage));
        }
        handler?.(call, calls.length - 1);
        return fakeRequest;
    }) as FakeRequest;
    request.calls = calls;
    return request;
}

export function respondWith(
    call: FakeRequestCall,
    body: Buffer | string,
    headers: Record<string, string> = {}
): void {
    const payload = Buffer.isBuffer(body) ? body : Buffer.from(body);
    call.response.statusCode = 200;
    call.response.headers = {
        "content-length": String(payload.length),
        ...headers,
    };
    call.response.complete = true;
    call.response.end(payload);
}

export function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
