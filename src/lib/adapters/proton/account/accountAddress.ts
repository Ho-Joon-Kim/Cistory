// Vendored from ProtonDriveApps/sdk incubating/account/js/src @ 05c9115 — MIT, Copyright (c) 2025-2026 Proton AG. Local changes marked "CISTORY:".
import type { PrivateKeyReference } from '@protontech/crypto';

export type AccountAddress = {
    email: string;
    addressId: string;
    primaryKeyIndex: number;
    keys: {
        id: string;
        key: PrivateKeyReference;
    }[];
};
