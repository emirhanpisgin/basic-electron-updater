// The asset-policy suite models the Windows desktop app and expects win32
// asset selection. Pin the host platform so the same expectations hold on
// Linux and macOS CI runners.
Object.defineProperty(process, "platform", { value: "win32" });
