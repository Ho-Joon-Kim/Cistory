/**
 * OwnTracks API Key Management
 *
 * POST   /api/settings/owntracks-key — Generate new API key
 * DELETE /api/settings/owntracks-key — Revoke API key
 */

import { createApiKeyRoute } from "@/lib/api-key-route";

const { POST, DELETE } = createApiKeyRoute({
  column: "ownTracksApiKey",
  prefix: "ot_",
  label: "OwnTracks",
});

export { POST, DELETE };
