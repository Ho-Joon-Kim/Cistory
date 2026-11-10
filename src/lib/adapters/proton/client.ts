import {
  type DriveEvent,
  type FileDownloader,
  type MaybeMissingPhotoNode,
  MemoryCache,
  NullFeatureFlagProvider,
  OpenPGPCryptoWithCryptoProxy,
  type ProtonDriveHTTPClient,
  type ThumbnailResult,
  ThumbnailType,
} from "@protontech/drive-sdk";
import { ProtonDrivePhotosClient } from "@protontech/drive-sdk/dist/protonDrivePhotosClient.js";
import type { AfterResponseHook } from "ky";
import { logger } from "@/lib/logger";
import {
  ApiClient,
  initAccount,
  type Logger,
  type SessionCredentials,
  type SessionInfo,
} from "./account";
import {
  PROTON_ACCOUNT_URL,
  PROTON_API_BASE_URL,
  PROTON_APP_VERSION,
  PROTON_AUTH_CLIENT_ID,
  PROTON_CLIENT_UID,
} from "./constants";
import { initProtonRuntime } from "./runtime";

export interface ProtonPhotosApi {
  /** `getMyPhotosRootFolder().treeEventScopeId` */
  getPhotosVolumeId(): Promise<string>;
  iterateTimeline(
    signal?: AbortSignal
  ): AsyncIterable<{ nodeUid: string; captureTime: Date; tags: number[] }>;
  iterateNodes(uids: string[], signal?: AbortSignal): AsyncIterable<MaybeMissingPhotoNode>;
  /** ThumbnailType.Type1 */
  iterateThumbnails(uids: string[], signal?: AbortSignal): AsyncIterable<ThumbnailResult>;
  iterateEvents(scopeId: string, cursor?: string, signal?: AbortSignal): AsyncIterable<DriveEvent>;
  /**
   * The original file of a photo node. Its bytes are only ever held in memory
   * (EXIF reading and thumbnail recovery); nothing downloaded is persisted.
   * `signal` also bounds every block request the downloader makes.
   */
  getFileDownloader(uid: string, signal?: AbortSignal): Promise<FileDownloader>;
}

/** Only warnings and errors are worth shipping; the SDK is chatty at debug/info. */
const sdkLogger: Logger = {
  debug() {},
  info() {},
  warn: (message, ...args) => logger.warn(message, args.length ? { args: args.length } : undefined),
  error: (message, ...args) =>
    logger.error(message, args.length ? { args: args.length } : undefined),
};

export function driveRequirementsHook(log: (value: string) => void): AfterResponseHook {
  const seen = new Set<string>();
  return (_request, _options, response) => {
    const value = response.headers.get("x-pm-drive-requirements");
    if (value && !seen.has(value)) {
      seen.add(value);
      log(value);
    }
  };
}

type Requester = Pick<ApiClient, "authenticatedRequest">;

/** Bridges the SDK's HTTP interface onto the ky-based client; errors surface as responses. */
export function buildSdkHttpClient(apiClient: Requester): ProtonDriveHTTPClient {
  return {
    fetchJson: (o) =>
      apiClient.authenticatedRequest(o.url, {
        method: o.method,
        ...(o.json !== undefined ? { json: o.json } : o.body !== undefined ? { body: o.body } : {}),
        headers: o.headers,
        timeout: o.timeoutMs,
        signal: o.signal,
        throwHttpErrors: false,
      }),
    fetchBlob: (o) =>
      apiClient.authenticatedRequest(o.url, {
        method: o.method,
        body: o.body,
        headers: o.headers,
        timeout: o.timeoutMs,
        signal: o.signal,
        throwHttpErrors: false,
      }),
  } as ProtonDriveHTTPClient;
}

export async function createProtonPhotosClient(opts: {
  credentials: SessionCredentials;
  refreshSession: (rejected: string | undefined) => Promise<SessionInfo | null>;
}): Promise<ProtonPhotosApi> {
  const { cryptoProxy, srpApi } = await initProtonRuntime();

  const apiClient = new ApiClient({
    baseUrl: PROTON_API_BASE_URL,
    appVersion: PROTON_APP_VERSION,
    credentials: opts.credentials,
    logger: sdkLogger,
    refreshSession: opts.refreshSession,
    afterResponseHooks: [
      driveRequirementsHook((value) =>
        logger.warn("[Proton] x-pm-drive-requirements", { requirements: value })
      ),
    ],
  });
  const { addresses } = await initAccount({
    authClientId: PROTON_AUTH_CLIENT_ID,
    apiClient,
    credentials: opts.credentials,
    cryptoProxy,
    srpApi,
    logger: sdkLogger,
    accountUrl: PROTON_ACCOUNT_URL,
  });

  const account = {
    getOwnPrimaryAddress: () => addresses.getOwnPrimaryAddress(),
    getOwnAddresses: () => addresses.getOwnAddresses(),
    getOwnAddress: (x: string) => addresses.getOwnAddress(x),
    hasProtonAccount: (e: string) => addresses.hasProtonAccount(e),
    getPublicKeys: (e: string, f?: boolean) => addresses.getPublicKeys(e, f),
  };

  const photos = new ProtonDrivePhotosClient({
    httpClient: buildSdkHttpClient(apiClient),
    entitiesCache: new MemoryCache(),
    cryptoCache: new MemoryCache(),
    account,
    openPGPCryptoModule: new OpenPGPCryptoWithCryptoProxy(cryptoProxy),
    srpModule: srpApi,
    config: { baseUrl: PROTON_API_BASE_URL, clientUid: PROTON_CLIENT_UID },
    featureFlagProvider: new NullFeatureFlagProvider(),
  } as never);

  return {
    getPhotosVolumeId: async () => {
      const root = await photos.getMyPhotosRootFolder();
      return root.treeEventScopeId;
    },
    iterateTimeline: (signal) => photos.iterateTimeline(signal) as never,
    iterateNodes: (uids, signal) => photos.iterateNodes(uids, signal),
    iterateThumbnails: (uids, signal) =>
      photos.iterateThumbnails(uids, ThumbnailType.Type1, signal),
    iterateEvents: (scopeId, cursor, signal) => photos.iterateEvents(scopeId, cursor, signal),
    getFileDownloader: (uid, signal) => photos.getFileDownloader(uid, signal),
  };
}
