import { execFile } from "child_process";

/**
 * Launches the downloaded installer and exits the app.
 * For NSIS/EXE, this will start the installer and quit the app.
 */
export function applyWindowsUpdate(installerPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
        execFile(installerPath, [], err => {
            if (err) return reject(err);
            // Optionally: quit the Electron app here
            resolve();
        });
    });
}
