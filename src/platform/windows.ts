import { execFile } from "child_process";

/**
 * Launches the downloaded installer and exits the app.
 * For NSIS/EXE installers, this will start the installer and quit the app.
 * Most Windows installers (including Squirrel.Windows) should be launched without arguments.
 */
export function applyWindowsUpdate(installerPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
        // Launch the installer without any arguments
        // Most Windows installers handle updates automatically when launched
        execFile(installerPath, [], (err: Error | null) => {
            if (err) return reject(err);
            // Quit the Electron app after starting the installer
            try {
                const electron = require("electron");
                if (electron.app) {
                    electron.app.quit();
                }
            } catch {
                // Not in Electron context, ignore
            }
            resolve();
        });
    });
}
