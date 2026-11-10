import type { Database } from "@/db";
import type { ProtonConnection } from "@/db/schema";
import { createProtonPhotosClient, type ProtonPhotosApi } from "@/lib/adapters/proton/client";
import { DbSessionCredentials } from "./credentials";
import { refreshProtonSession } from "./token";

/** Pins a client to the session a sync tick started with. */
export interface ProtonSessionGuard {
  /** The tick fence's session uid. */
  expectedUid: string;
  /**
   * Called when a refresh hands back a different session (a reconnect landed
   * mid-tick). The refresh is then refused, so the request fails, and the tick
   * aborts instead of reading the new session's library under the old fence.
   */
  onSessionChanged: () => void;
}

/**
 * Opens a Photos client for a stored connection. Throws if the stored secrets
 * cannot be decrypted; callers treat that as a sync failure.
 */
export function openProtonPhotos(
  db: Database,
  connection: ProtonConnection,
  guard?: ProtonSessionGuard
): Promise<ProtonPhotosApi> {
  return createProtonPhotosClient({
    credentials: DbSessionCredentials.fromConnection(connection),
    refreshSession: async (rejected) => {
      const session = await refreshProtonSession(db, connection.userId, rejected);
      if (session && guard && session.uid !== guard.expectedUid) {
        guard.onSessionChanged();
        return null;
      }
      return session;
    },
  });
}
