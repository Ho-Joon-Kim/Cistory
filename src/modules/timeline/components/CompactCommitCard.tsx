"use client";

import { memo } from "react";
import { GitCommit } from "lucide-react";
import type { TimelineCommit } from "../hooks";

interface CompactCommitCardProps {
  commit: TimelineCommit;
  onSelectDate: () => void;
}

export const CompactCommitCard = memo(function CompactCommitCard({
  commit,
  onSelectDate,
}: CompactCommitCardProps) {
  const messageFirstLine = commit.message.split("\n")[0];

  return (
    <div
      className="compact-commit flex items-center gap-2 py-0.5 px-2 rounded cursor-pointer text-muted-foreground"
      onClick={onSelectDate}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelectDate();
        }
      }}
    >
      <GitCommit className="h-3 w-3 flex-shrink-0 opacity-50" />
      <span className="text-xs font-mono opacity-60">{commit.sha.slice(0, 7)}</span>
      <span className="text-xs truncate">{messageFirstLine}</span>
    </div>
  );
});
