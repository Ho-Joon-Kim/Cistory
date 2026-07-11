import { createOAuthStateCodec } from "./oauth-state";

/**
 * Signed, stateless OAuth `state` for the Withings authorize/callback flow. The
 * context is DISTINCT from Google Health's so the two flows can never verify each
 * other's tokens (see createOAuthStateCodec + the isolation test).
 */
const codec = createOAuthStateCodec("withings-oauth-state");

export const createOAuthState = codec.createOAuthState;
export const verifyOAuthState = codec.verifyOAuthState;
