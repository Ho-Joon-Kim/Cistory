// Vendored from ProtonDriveApps/sdk incubating/account/js/src @ 05c9115 — MIT, Copyright (c) 2025-2026 Proton AG. Local changes marked "CISTORY:".
export interface Logger {
    debug(message: string, ...args: unknown[]): void;
    info(message: string, ...args: unknown[]): void;
    warn(message: string, ...args: unknown[]): void;
    error(message: string, ...args: unknown[]): void;
}
