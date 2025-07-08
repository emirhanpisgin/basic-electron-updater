import { execFile } from "child_process";

/**
 * Opens the DMG or ZIP in Finder, or launches the installer.
 */
export function applyMacUpdate(installerPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
        execFile("open", [installerPath], err => {
            if (err) return reject(err);
            // Optionally: quit the Electron app here
            resolve();
        });
    });
}
