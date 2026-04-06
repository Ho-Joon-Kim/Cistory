import type { TimelineCommit } from "./hooks";
import type { StayPointData, TrackData } from "@/modules/location/hooks";
import type { CodingSessionData, CodingStatData } from "@/modules/wakatime/hooks";
import type { TransactionItem } from "@/modules/spending/hooks";

// --- Unified timeline event types ---

export type TimelineEvent =
  | { type: "commit"; timestamp: string; data: TimelineCommit }
  | { type: "coding"; timestamp: string; data: { sessions: CodingSessionData[]; stats?: CodingStatData } }
  | { type: "stay"; timestamp: string; data: StayPointData }
  | { type: "track"; timestamp: string; data: TrackData }
  | { type: "transaction"; timestamp: string; data: TransactionItem };

export interface TimeEventSubGroup {
  label: string | null;
  events: TimelineEvent[];
}
