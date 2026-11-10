// Barrel re-export for the Google Health adapter. Mirrors the Withings adapter's
// interface.ts so callers import from a stable path regardless of internal layout.
export {
  buildHealthScope,
  createGoogleHealthAdapter,
  GOOGLE_AUTH_URL,
  GOOGLE_HEALTH_DEFAULT_SCOPE,
  GOOGLE_HEALTH_OPTIONAL_SCOPES,
  GOOGLE_REVOKE_URL,
  GOOGLE_TOKEN_URL,
  GoogleHealthAdapter,
  GoogleHealthApiError,
  GoogleHealthAuthError,
  type GoogleHealthDataPoint,
  type GoogleHealthOptionalScope,
  HEALTH_API_BASE,
  hasHealthScope,
  type ListResult,
  type ParsedTokens,
  type RollUpResult,
} from "./google-health";
