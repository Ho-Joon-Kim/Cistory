/**
 * Health import API key management.
 *
 * POST   /api/settings/health-import-key — Generate a new key
 * DELETE /api/settings/health-import-key — Revoke it
 *
 * The key authenticates the on-device Health Connect importer
 * (MacroDroid/Tasker → POST /api/health-import) that backfills sleep/exercise.
 */

import { createApiKeyRoute } from "@/lib/api-key-route";

const { POST, DELETE } = createApiKeyRoute({
  column: "healthImportApiKey",
  prefix: "hi_",
  label: "Health Import",
});

export { POST, DELETE };
