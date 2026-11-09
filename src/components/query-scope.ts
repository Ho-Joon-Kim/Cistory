/**
 * Which query cache the app renders under. `identity` is the session id,
 * "anonymous" once the session settled without one, or undefined while the
 * first session request is still in flight.
 */
export interface QueryScope {
  identity: string | undefined;
  generation: number;
}

export const INITIAL_QUERY_SCOPE: QueryScope = { identity: undefined, generation: 0 };

/**
 * Advance the cache scope for the latest session state. The cache is replaced
 * (generation + 1) at every authentication boundary — sign-in, sign-out, or a
 * new session for the same user — but NOT when the very first session request
 * settles: the queries already in flight were sent with that same cookie, and
 * remounting there aborted and refetched every query on every page load.
 */
export function nextQueryScope(prev: QueryScope, identity: string | undefined): QueryScope {
  if (identity === undefined) return prev;
  if (prev.identity === undefined) return { identity, generation: prev.generation };
  if (prev.identity === identity) return prev;
  return { identity, generation: prev.generation + 1 };
}
