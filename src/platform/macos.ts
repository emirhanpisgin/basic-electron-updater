import { execFile } from "child_process";

/**
 * Opens the DMG or ZIP in Finder, or launches the installer.
 */
export function applyMacUpdate(installerPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
        execFile("open", [installerPath], (err: Error | null) => {
            if (err) return reject(err);
            // For .pkg files, don't quit immediately as user needs to complete installation
            // For .dmg/.zip files, user will handle the update manually
            resolve();
        });
    });
}
