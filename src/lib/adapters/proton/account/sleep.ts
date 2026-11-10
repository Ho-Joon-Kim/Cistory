// Vendored from ProtonDriveApps/sdk incubating/account/js/src @ 05c9115 — MIT, Copyright (c) 2025-2026 Proton AG. Local changes marked "CISTORY:".
export function sleepMs(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) {
            reject(signal.reason ?? new Error('Aborted'));
            return;
        }

        const timeout = setTimeout(() => {
            signal?.removeEventListener('abort', onAbort);
            resolve();
        }, ms);

        const onAbort = () => {
            clearTimeout(timeout);
            reject(signal?.reason ?? new Error('Aborted'));
        };

        signal?.addEventListener('abort', onAbort, { once: true });
    });
}
