import type { Database } from "@/db";
import type { ProtonConnection } from "@/db/schema";
import { createProtonPhotosClient, type ProtonPhotosApi } from "@/lib/adapters/proton/client";
import { DbSessionCredentials } from "./credentials";
import { refreshProtonSession } from "./token";

/**
 * Opens a Photos client for a stored connection. Throws if the stored secrets
 * cannot be decrypted; callers treat that as a sync failure.
 */
export function openProtonPhotos(
  db: Database,
  connection: ProtonConnection
): Promise<ProtonPhotosApi> {
  return createProtonPhotosClient({
    credentials: DbSessionCredentials.fromConnection(connection),
    refreshSession: (rejected) => refreshProtonSession(db, connection.userId, rejected),
  });
}
