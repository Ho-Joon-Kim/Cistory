import { createOAuthStateCodec } from "./oauth-state";

/**
 * Signed, stateless OAuth `state` for the WakaTime authorize/callback flow. The
 * context is DISTINCT from Withings' and Google Health's so no flow can ever
 * verify another's state (see createOAuthStateCodec + the isolation tests).
 */
const codec = createOAuthStateCodec("wakatime-oauth-state");

export const createOAuthState = codec.createOAuthState;
export const verifyOAuthState = codec.verifyOAuthState;
