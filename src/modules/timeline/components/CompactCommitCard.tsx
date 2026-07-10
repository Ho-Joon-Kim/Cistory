import { memo } from "react";
import type { TimelineCommit } from "../hooks";
import { CommitCard } from "./CommitCard";

interface CompactCommitCardProps {
  commit: TimelineCommit;
  onSelectDate: () => void;
  repoColor?: string;
  isLast?: boolean;
}

export const CompactCommitCard = memo(function CompactCommitCard({
  commit,
  onSelectDate,
  repoColor,
  isLast,
}: CompactCommitCardProps) {
  return (
    <CommitCard
      commit={commit}
      repoColor={repoColor}
      isExpanded={false}
      onToggle={onSelectDate}
      isLast={isLast}
    />
  );
});
