import {
    createPublicKey,
    KeyObject,
    verify as cryptoVerify,
} from "crypto";
import type { TrustedPublicKey } from "../types";
import { SecurityConfigError, UpdateSecurityError } from "./errors";

export interface ParsedTrustedKey {
    keyId: string;
    key: KeyObject;
}

const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;

function decodeBase64(value: string, label: string): Buffer {
    const compact = value.replace(/\s+/g, "");
    if (!compact || !BASE64_PATTERN.test(compact)) {
        throw new SecurityConfigError(
            "INVALID_PUBLIC_KEY",
            `${label} is not valid base64`
        );
    }
    return Buffer.from(compact, "base64");
}

function importPublicKey(value: string, keyId: string): KeyObject {
    let key: KeyObject;
    try {
        if (/-----BEGIN PUBLIC KEY-----/.test(value)) {
            key = createPublicKey(value);
        } else {
            key = createPublicKey({
                key: decodeBase64(value, `Public key ${keyId}`),
                format: "der",
                type: "spki",
            });
        }
    } catch {
        throw new SecurityConfigError(
            "INVALID_PUBLIC_KEY",
            `Could not parse public key ${keyId}`
        );
    }

    if (key.asymmetricKeyType !== "ed25519") {
        throw new SecurityConfigError(
            "INVALID_PUBLIC_KEY",
            `Public key ${keyId} must be Ed25519, got ${key.asymmetricKeyType ?? "unknown"}`
        );
    }
    return key;
}

/** Parses and validates the application-pinned Ed25519 keys. */
export function parseTrustedPublicKeys(
    keys: readonly TrustedPublicKey[] | undefined
): ParsedTrustedKey[] {
    if (!Array.isArray(keys) || keys.length === 0) {
        throw new SecurityConfigError(
            "INSECURE_CONFIG",
            "At least one pinned Ed25519 public key is required for signed updates"
        );
    }

    const seen = new Set<string>();
    return keys.map((entry) => {
        if (
            !entry ||
            typeof entry.keyId !== "string" ||
            entry.keyId.trim().length === 0
        ) {
            throw new SecurityConfigError(
                "INVALID_PUBLIC_KEY",
                "Each trusted public key needs a non-empty keyId"
            );
        }
        if (seen.has(entry.keyId)) {
            throw new SecurityConfigError(
                "INVALID_PUBLIC_KEY",
                `Duplicate public key id: ${entry.keyId}`
            );
        }
        seen.add(entry.keyId);
        if (typeof entry.publicKey !== "string") {
            throw new SecurityConfigError(
                "INVALID_PUBLIC_KEY",
                `Public key ${entry.keyId} must be a string`
            );
        }
        return {
            keyId: entry.keyId,
            key: importPublicKey(entry.publicKey, entry.keyId),
        };
    });
}

export interface SignatureMatch {
    keyId: string;
}

/**
 * Verifies a detached Ed25519 signature over the exact manifest bytes. The
 * manifest-provided key id is only used after cryptographic verification to
 * select among application-pinned keys; it is never trusted on its own.
 */
export function verifyDetachedSignature(
    payload: Buffer,
    signatureBase64: string,
    keys: readonly ParsedTrustedKey[],
    expectedKeyId: string
): SignatureMatch {
    if (typeof signatureBase64 !== "string") {
        throw new UpdateSecurityError(
            "INVALID_SIGNATURE",
            "Manifest signature must be a base64 string"
        );
    }
    const compact = signatureBase64.replace(/\s+/g, "");
    if (!compact || !BASE64_PATTERN.test(compact)) {
        throw new UpdateSecurityError(
            "INVALID_SIGNATURE",
            "Manifest signature is not valid base64"
        );
    }

    const signature = Buffer.from(compact, "base64");
    if (signature.length !== 64) {
        throw new UpdateSecurityError(
            "INVALID_SIGNATURE",
            `Manifest signature must be 64 bytes, got ${signature.length}`
        );
    }

    let matched: ParsedTrustedKey | undefined;
    for (const key of keys) {
        let valid = false;
        try {
            valid = cryptoVerify(null, payload, key.key, signature);
        } catch {
            valid = false;
        }
        if (valid) {
            matched = key;
            break;
        }
    }

    if (!matched) {
        throw new UpdateSecurityError(
            "UNKNOWN_KEY",
            "Manifest signature did not verify against any pinned public key"
        );
    }
    if (matched.keyId !== expectedKeyId) {
        throw new UpdateSecurityError(
            "INVALID_SIGNATURE",
            `Manifest key id ${expectedKeyId} does not match the verified key ${matched.keyId}`
        );
    }
    return { keyId: matched.keyId };
}
