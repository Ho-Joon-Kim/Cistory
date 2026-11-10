import type { ProtonConnection } from "@/db/schema";
import type { SessionCredentials, SessionInfo } from "@/lib/adapters/proton/account";
import { decryptSecret } from "@/lib/crypto";

function decryptNullable(enc: string | null): string | undefined {
  return enc === null ? undefined : decryptSecret(enc);
}

/**
 * Request-scoped, memory-only credentials for one Proton connection.
 *
 * Nothing here writes to the database: rotated tokens are persisted by
 * `refreshProtonSession` while it still holds the per-user advisory lock, and
 * `ApiClient` then mirrors the result into memory via `setSessionInfo`.
 */
export class DbSessionCredentials implements SessionCredentials {
  private listeners: Array<() => void> = [];

  private constructor(
    private session: { uid?: string; accessToken?: string; refreshToken?: string },
    private keyPassword: string | undefined
  ) {}

  static fromConnection(row: ProtonConnection): DbSessionCredentials {
    return new DbSessionCredentials(
      {
        uid: decryptNullable(row.uidEnc),
        accessToken: decryptNullable(row.accessTokenEnc),
        refreshToken: decryptNullable(row.refreshTokenEnc),
      },
      decryptNullable(row.keyPasswordEnc)
    );
  }

  /** Credentials that exist only in memory (a just-completed fork, not yet stored). */
  static fromSession(
    tokens: { uid: string; accessToken: string; refreshToken: string },
    keyPassword: string
  ): DbSessionCredentials {
    return new DbSessionCredentials({ ...tokens }, keyPassword);
  }

  get uid(): string | undefined {
    return this.session.uid;
  }

  get accessToken(): string | undefined {
    return this.session.accessToken;
  }

  get refreshToken(): string | undefined {
    return this.session.refreshToken;
  }

  on(event: "sessionInfoChanged", callback: () => void): void {
    if (event === "sessionInfoChanged") this.listeners.push(callback);
  }

  isLoggedIn(): boolean {
    return Boolean(this.session.uid && this.session.accessToken);
  }

  isTelemetryEnabled(): boolean {
    return false;
  }

  getUserKeyPassword(): string | undefined {
    return this.keyPassword;
  }

  async load(): Promise<void> {}

  async setUserKeyPassword(userKeyPassword: string): Promise<void> {
    this.keyPassword = userKeyPassword;
  }

  async setSessionInfo(info: SessionInfo): Promise<void> {
    this.session = {
      uid: info.uid,
      accessToken: info.accessToken,
      refreshToken: info.refreshToken ?? this.session.refreshToken,
    };
    for (const listener of this.listeners) listener();
  }

  async setTelemetryEnabled(): Promise<void> {}

  async signOut(): Promise<void> {
    this.session = {};
    this.keyPassword = undefined;
  }
}
