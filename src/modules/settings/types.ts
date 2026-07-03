/**
 * Shared /api/settings response contract.
 *
 * Single source of truth for both the API route (serializer) and the client
 * hook (consumer) — the two previously declared separate interfaces that had
 * already drifted: PUT returned a 3-field subset, and the hook replacing its
 * state with it silently wiped hasOwnTracksKey/hasTossKey/hasWakaTimeKey.
 */
export interface UserSettings {
  theme: "light" | "dark" | "system";
  syncIntervalHours: number;
  lastSyncedAt: string | null;
  hasOwnTracksKey: boolean;
  hasTossKey: boolean;
  tossMyName: string | null;
  hasWakaTimeKey: boolean;
  lastLat: number | null;
  lastLon: number | null;
}

export const DEFAULT_USER_SETTINGS: UserSettings = {
  theme: "system",
  syncIntervalHours: 1,
  lastSyncedAt: null,
  hasOwnTracksKey: false,
  hasTossKey: false,
  tossMyName: null,
  hasWakaTimeKey: false,
  lastLat: null,
  lastLon: null,
};
