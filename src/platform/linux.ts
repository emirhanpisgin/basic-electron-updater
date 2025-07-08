import { execFile } from "child_process";

/**
 * Launches the AppImage, .deb, .rpm, or .tar.gz installer.
 */
export function applyLinuxUpdate(installerPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
        execFile(installerPath, [], err => {
            if (err) return reject(err);
            // Optionally: quit the Electron app here
            resolve();
        });
    });
}
