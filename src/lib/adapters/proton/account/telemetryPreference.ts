// Vendored from ProtonDriveApps/sdk incubating/account/js/src @ 05c9115 — MIT, Copyright (c) 2025-2026 Proton AG. Local changes marked "CISTORY:".
import type { AccountApi } from './accountApi';
import type { Logger } from './logger';

export async function fetchTelemetryEnabled(accountApi: AccountApi, logger: Logger): Promise<boolean> {
    try {
        const settings = await accountApi.settings();
        return settings.UserSettings?.Telemetry === 1;
    } catch (error: unknown) {
        logger.error('Failed to fetch telemetry preference', error);
        return false;
    }
}
