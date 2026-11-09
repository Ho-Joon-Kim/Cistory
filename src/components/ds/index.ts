/**
 * Design-system components (redesign v2). Tokens live in src/app/globals.css,
 * formatters in src/lib/format.ts, the fact framework in src/lib/facts.
 */
export { AiLine } from "./AiLine";
export { CategoryMark, LedgerMark } from "./CategoryMark";
export { ChartAnnotation } from "./ChartAnnotation";
export {
  CATEGORY_MARK_PATHS,
  categoryColor,
  categoryTint,
  LEDGER_MARK_LABELS,
  LEDGER_MARK_PATHS,
  type LedgerMarkKind,
} from "./category-marks";
export { EvidenceScope, type EvidenceState, useEvidence, useEvidenceTrigger } from "./evidence";
export { FactPopover, FactTrigger } from "./FactTrigger";
export { CountUp, HeroNumber, SecondaryNumber } from "./Numbers";
export { MetaLine, PageContainer, PageTitle } from "./PageTitle";
export { RowFlag, RowFlagReason } from "./RowFlag";
export { Segmented, type SegmentedItem } from "./Segmented";
export { ShareRow } from "./ShareRow";
export { Sheet, SheetClose } from "./Sheet";
export {
  ArrowRight,
  Chevron,
  Disclosure,
  SOURCE_ICON_PATHS,
  SourceGlyph,
  type SourceIconName,
  SourceTile,
} from "./SourceIcon";
export { EmptyState, ErrorState, LoadingState } from "./States";
export { StatusBadge } from "./StatusBadge";
export {
  deriveSourceStatus,
  SOURCE_STATUS_LABELS,
  type SourceStatus,
  STALE_AFTER_MS,
} from "./status";
