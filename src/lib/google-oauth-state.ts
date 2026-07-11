import { createOAuthStateCodec } from "./oauth-state";

/**
 * Signed, stateless OAuth `state` for the Google Health (Fitbit) authorize/callback
 * flow. The context is DISTINCT from Withings' so the two flows can never verify
 * each other's tokens (see createOAuthStateCodec + the isolation test).
 */
const codec = createOAuthStateCodec("google-health-oauth-state");

export const createOAuthState = codec.createOAuthState;
export const verifyOAuthState = codec.verifyOAuthState;
