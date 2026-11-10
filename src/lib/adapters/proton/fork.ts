import { AccountApi } from "./account/accountApi";
import { ApiClient } from "./account/apiClient";
import { Auth, type ForkPollResult, type ProtonSessionTokens } from "./account/auth";
import type { Logger } from "./account/logger";
import type { SessionCredentials } from "./account/sessionCredentials";
import { Srp, type SrpApiInterface } from "./account/srp";
import {
  PROTON_ACCOUNT_URL,
  PROTON_API_BASE_URL,
  PROTON_APP_VERSION,
  PROTON_AUTH_CLIENT_ID,
} from "./constants";

export type { ForkPollResult, ProtonSessionTokens };

const FORK_TTL_MS = 10 * 60 * 1000;

const silent: Logger = { debug() {}, info() {}, warn() {}, error() {} };

/** The fork endpoints are unauthenticated, so credentials are never read or written. */
const inertCredentials: SessionCredentials = {
  uid: undefined,
  accessToken: undefined,
  refreshToken: undefined,
  on() {},
  isLoggedIn: () => false,
  isTelemetryEnabled: () => false,
  getUserKeyPassword: () => undefined,
  async load() {},
  async setUserKeyPassword() {},
  async setSessionInfo() {},
  async setTelemetryEnabled() {},
  async signOut() {},
};

function createAuth(): Auth {
  const apiClient = new ApiClient({
    baseUrl: PROTON_API_BASE_URL,
    appVersion: PROTON_APP_VERSION,
    credentials: inertCredentials,
    logger: silent,
  });
  const accountApi = new AccountApi(apiClient);
  // The fork flow never touches SRP, so the crypto primitives are not needed
  // (and importing them here would break the runtime.ts-only import rule).
  const srp = new Srp(accountApi, {} as SrpApiInterface);
  return new Auth(
    PROTON_AUTH_CLIENT_ID,
    accountApi,
    inertCredentials,
    srp,
    silent,
    PROTON_ACCOUNT_URL
  );
}

export async function startProtonFork(): Promise<{
  selector: string;
  signInUrl: string;
  encryptionKey: Buffer;
  expiresAt: Date;
}> {
  const begun = await createAuth().beginWebFork();
  return { ...begun, expiresAt: new Date(Date.now() + FORK_TTL_MS) };
}

export function pollProtonFork(selector: string, encryptionKey: Buffer): Promise<ForkPollResult> {
  return createAuth().pollWebForkOnce(selector, encryptionKey);
}
