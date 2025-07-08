import { execFile } from "child_process";

/**
 * Launches the downloaded installer and exits the app.
 * For NSIS/EXE, this will start the installer and quit the app.
 */
export function applyWindowsUpdate(installerPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
        // For Squirrel.Windows, the installer may require different arguments
        const isSquirrelInstaller = installerPath.toLowerCase().includes('setup.exe');
        const args = isSquirrelInstaller ? ['--update'] : [];
        
        execFile(installerPath, args, (err: any) => {
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
