import * as path from "path";

/**
 * Validates a remote asset name before it is used as or appended to a local
 * path. Remote names are untrusted: they must be a plain basename and must not
 * contain path separators, NUL/control characters, or Windows-reserved
 * trailing dots/spaces.
 */
export function assertSafeAssetName(name: unknown): string {
    if (typeof name !== "string" || name.length === 0) {
        throw new Error("Asset name must be a non-empty string");
    }
    if (name.length > 255) {
        throw new Error(`Asset name is too long: ${name.length} characters`);
    }
    if (name === "." || name === "..") {
        throw new Error(`Unsafe asset name: ${JSON.stringify(name)}`);
    }
    if (name.includes("/") || name.includes("\\") || name.includes("\0")) {
        throw new Error(`Unsafe asset name contains a path separator: ${JSON.stringify(name)}`);
    }
    for (const character of name) {
        const code = character.codePointAt(0);
        if (code !== undefined && (code < 0x20 || code === 0x7f)) {
            throw new Error(
                `Unsafe asset name contains a control character: ${JSON.stringify(name)}`
            );
        }
    }
    if (name.endsWith(".") || name.endsWith(" ")) {
        throw new Error(`Unsafe asset name has a trailing dot or space: ${JSON.stringify(name)}`);
    }
    if (path.basename(name) !== name) {
        throw new Error(`Unsafe asset name is not a basename: ${JSON.stringify(name)}`);
    }
    return name;
}

export function isSafeAssetName(name: unknown): name is string {
    try {
        assertSafeAssetName(name);
        return true;
    } catch {
        return false;
    }
}

/** True only when `candidate` is strictly below `directory`. */
export function isPathInsideDirectory(
    candidate: string,
    directory: string
): boolean {
    const base = path.resolve(directory);
    const target = path.resolve(candidate);
    const relative = path.relative(base, target);
    return (
        relative.length > 0 &&
        !path.isAbsolute(relative) &&
        relative !== ".." &&
        !relative.startsWith(`..${path.sep}`)
    );
}
