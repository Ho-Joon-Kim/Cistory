/**
 * Shared /api/settings response contract.
 *
 * Single source of truth for both the API route (serializer) and the client
 * hook (consumer) — the two previously declared separate interfaces that had
 * already drifted: PUT returned a 3-field subset, and the hook replacing its
 * state with it silently wiped hasOwnTracksKey/hasTossKey/hasWakaTimeKey (now WakaTime OAuth fields).
 */
export interface UserSettings {
  theme: "light" | "dark" | "system";
  syncIntervalHours: number;
  lastSyncedAt: string | null;
  hasOwnTracksKey: boolean;
  hasTossKey: boolean;
  tossMyName: string | null;
  hasWakaTimeConnection: boolean;
  wakatimeNeedsReauth: boolean;
  /** A deprecated API key is still stored but there is no OAuth connection —
   *  WakaTime rejects API keys for reads, so the card prompts a reconnect. */
  hasLegacyWakaTimeKey: boolean;
  lastLat: number | null;
  lastLon: number | null;
  hasWithingsConnection: boolean;
  withingsUserId: string | null;
  withingsLastSyncedAt: string | null;
  withingsNeedsReauth: boolean;
  hasHealthConnection: boolean;
  healthLastSyncedAt: string | null;
  /** Latest Google Health webhook notification received for this user, if any. */
  healthLastWebhookAt: string | null;
  healthNeedsReauth: boolean;
  hasHealthImportKey: boolean;
}

export const DEFAULT_USER_SETTINGS: UserSettings = {
  theme: "system",
  syncIntervalHours: 1,
  lastSyncedAt: null,
  hasOwnTracksKey: false,
  hasTossKey: false,
  tossMyName: null,
  hasWakaTimeConnection: false,
  wakatimeNeedsReauth: false,
  hasLegacyWakaTimeKey: false,
  lastLat: null,
  lastLon: null,
  hasWithingsConnection: false,
  withingsUserId: null,
  withingsLastSyncedAt: null,
  withingsNeedsReauth: false,
  hasHealthConnection: false,
  healthLastSyncedAt: null,
  healthLastWebhookAt: null,
  healthNeedsReauth: false,
  hasHealthImportKey: false,
};
