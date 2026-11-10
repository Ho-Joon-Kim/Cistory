import { and, isNotNull, isNull, type SQL } from "drizzle-orm";
import { photos } from "@/db/schema";

/**
 * The one exposure rule: a photo is counted or served only once its details
 * passed screening and it has not been deleted upstream.
 */
export function photoIsExposed(): SQL {
  return and(isNotNull(photos.detailsSyncedAt), isNull(photos.deletedAt)) as SQL;
}
