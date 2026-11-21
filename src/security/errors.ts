export type SecurityErrorCode =
    | "INSECURE_CONFIG"
    | "INVALID_PUBLIC_KEY"
    | "UNKNOWN_KEY"
    | "INVALID_SIGNATURE"
    | "MANIFEST_MISSING"
    | "INVALID_MANIFEST"
    | "EXPIRED_MANIFEST"
    | "WRONG_APP"
    | "WRONG_VERSION"
    | "WRONG_PLATFORM"
    | "WRONG_ARCHITECTURE"
    | "WRONG_CHANNEL"
    | "UNSAFE_ASSET"
    | "UNSAFE_URL"
    | "HASH_REQUIRED"
    | "HASH_MISMATCH"
    | "SIZE_MISMATCH"
    | "DOWNGRADE"
    | "CONCURRENT_UPDATE"
    | "AUTHENTICODE_REQUIRED"
    | "AUTHENTICODE_FAILED";

/** Base error for rejected security configuration or update material. */
export class UpdateSecurityError extends Error {
    readonly code: SecurityErrorCode;

    constructor(code: SecurityErrorCode, message: string, options?: ErrorOptions) {
        super(message, options);
        this.name = "UpdateSecurityError";
        this.code = code;
    }
}

/** Invalid or insecure updater configuration. */
export class SecurityConfigError extends UpdateSecurityError {
    constructor(code: SecurityErrorCode, message: string) {
        super(code, message);
        this.name = "SecurityConfigError";
    }
}
