/**
 * Toss Notification API Key Management
 *
 * POST   /api/settings/toss-key — Generate new API key
 * DELETE /api/settings/toss-key — Revoke API key
 */

import { createApiKeyRoute } from "@/lib/api-key-route";

const { POST, DELETE } = createApiKeyRoute({
  column: "tossNotificationApiKey",
  prefix: "toss_",
  label: "Toss",
});

export { POST, DELETE };
