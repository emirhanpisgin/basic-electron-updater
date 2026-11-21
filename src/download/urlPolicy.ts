import * as net from "net";
import { UpdateSecurityError } from "../security/errors";

export interface DownloadPolicy {
    /** Exact hostnames allowed for downloads and redirects. */
    allowedHosts?: readonly string[];
    /** Maximum bytes accepted for the response body. */
    maxBytes?: number;
    /** Socket/inactivity timeout for the request and response. */
    requestTimeoutMs?: number;
}

function stripBrackets(hostname: string): string {
    return hostname.startsWith("[") && hostname.endsWith("]")
        ? hostname.slice(1, -1)
        : hostname;
}

function isPrivateIpv4(hostname: string): boolean {
    const parts = hostname.split(".").map((part) => Number(part));
    if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
        return false;
    }
    const [a, b] = parts;
    return (
        a === 0 ||
        a === 10 ||
        a === 127 ||
        (a === 100 && b >= 64 && b <= 127) ||
        (a === 169 && b === 254) ||
        (a === 172 && b >= 16 && b <= 31) ||
        (a === 192 && b === 168) ||
        (a === 192 && b === 0) ||
        (a === 198 && (b === 18 || b === 19)) ||
        a >= 224
    );
}

function isPrivateIpv6(hostname: string): boolean {
    const value = hostname.toLowerCase();
    if (value === "::" || value === "::1") return true;
    if (value.startsWith("fc") || value.startsWith("fd")) return true;
    if (value.startsWith("fe8") || value.startsWith("fe9") || value.startsWith("fea") || value.startsWith("feb")) {
        return true;
    }
    if (value.startsWith("ff")) return true;
    // IPv4-mapped addresses such as ::ffff:127.0.0.1.
    const mapped = value.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateIpv4(mapped[1]);
    return false;
}

export function isPrivateHostname(hostname: string): boolean {
    const host = stripBrackets(hostname).toLowerCase();
    if (!host) return true;
    if (host === "localhost" || host.endsWith(".localhost")) return true;
    if (host.endsWith(".local") || host.endsWith(".internal")) return true;
    if (net.isIP(host) === 4) return isPrivateIpv4(host);
    if (net.isIP(host) === 6) return isPrivateIpv6(host);
    return false;
}

/**
 * Validates a download URL and every redirect destination. This blocks HTTP
 * downgrade, credentials in URLs, nonstandard ports, private/loopback hosts
 * and hosts outside the configured allow-list. DNS rebinding is documented as
 * a residual risk; the default allow-list contains only GitHub asset hosts.
 */
export function validateDownloadUrl(
    rawUrl: string,
    policy?: DownloadPolicy,
    baseUrl?: string
): URL {
    let url: URL;
    try {
        url = new URL(rawUrl, baseUrl);
    } catch {
        throw new UpdateSecurityError(
            "UNSAFE_URL",
            `Invalid download URL: ${rawUrl}`
        );
    }

    if (url.protocol !== "https:") {
        throw new UpdateSecurityError(
            "UNSAFE_URL",
            `Refusing insecure non-HTTPS download URL: ${url.protocol}`
        );
    }
    if (url.username || url.password) {
        throw new UpdateSecurityError(
            "UNSAFE_URL",
            "Download URL must not contain credentials"
        );
    }
    if (url.port && url.port !== "443") {
        throw new UpdateSecurityError(
            "UNSAFE_URL",
            `Download URL uses a disallowed port: ${url.port}`
        );
    }

    const hostname = url.hostname.toLowerCase();
    if (isPrivateHostname(hostname)) {
        throw new UpdateSecurityError(
            "UNSAFE_URL",
            `Download URL points to a private, loopback or local host: ${hostname}`
        );
    }

    if (policy?.allowedHosts && policy.allowedHosts.length > 0) {
        const allowed = policy.allowedHosts.map((host) => host.toLowerCase());
        if (!allowed.includes(hostname)) {
            throw new UpdateSecurityError(
                "UNSAFE_URL",
                `Download host is not allowed: ${hostname}`
            );
        }
    }

    return url;
}
