import { execFile } from "child_process";
import { chmod } from "fs";

/**
 * Launches the AppImage, .deb, .rpm, or .tar.gz installer.
 */
export function applyLinuxUpdate(installerPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
        // Make AppImage executable if needed
        if (installerPath.toLowerCase().endsWith('.appimage')) {
            chmod(installerPath, 0o755, (chmodErr) => {
                if (chmodErr) return reject(chmodErr);
                executeInstaller();
            });
        } else {
            executeInstaller();
        }
        
        function executeInstaller(): void {
            const isPackageManager = installerPath.endsWith('.deb') || installerPath.endsWith('.rpm');
            if (isPackageManager) {
                // For package managers, we can't auto-install, just open the file
                execFile("xdg-open", [installerPath], (err: Error | null) => {
                    if (err) return reject(err);
                    resolve();
                });
            } else {
                // For AppImage or other executables
                execFile(installerPath, [], (err: Error | null) => {
                    if (err) return reject(err);
                    resolve();
                });
            }
        }
    });
}
