"use client";

import type { ReactNode } from "react";

export type ActivityAccent = "location" | "movement" | "expense" | "income" | "coding";

interface ActivityCardProps {
  accent: ActivityAccent;
  kind: string;
  chip?: ReactNode;
  icon: ReactNode;
  title: ReactNode;
  trailing: ReactNode;
  detail?: ReactNode;
  stats: ReactNode;
  expanded?: boolean;
  onToggle?: () => void;
  toggleLabel?: string;
  children?: ReactNode;
}

export function ActivityCard({
  accent,
  kind,
  chip,
  icon,
  title,
  trailing,
  detail,
  stats,
  expanded = false,
  onToggle,
  toggleLabel,
  children,
}: ActivityCardProps) {
  return (
    <article className={`timeline-activity-card is-${accent} ${expanded ? "is-expanded" : ""}`}>
      {onToggle && (
        <button
          type="button"
          className="timeline-activity-toggle"
          onClick={onToggle}
          aria-expanded={expanded}
          aria-label={toggleLabel}
        />
      )}

      <div className="timeline-activity-main">
        <div className="timeline-activity-kind">
          <span className="timeline-activity-dot" aria-hidden="true" />
          <span>{kind}</span>
          {chip && <span className="timeline-activity-chip">{chip}</span>}
        </div>
        <div className="timeline-activity-title">
          <span className="timeline-activity-icon" aria-hidden="true">
            {icon}
          </span>
          <strong title={typeof title === "string" ? title : undefined}>{title}</strong>
        </div>
        <div className="timeline-activity-trailing">{trailing}</div>
      </div>

      <div className="timeline-activity-secondary">
        {detail && (
          <div
            className="timeline-activity-detail"
            title={typeof detail === "string" ? detail : undefined}
          >
            {detail}
          </div>
        )}
        <div className="timeline-activity-stats">{stats}</div>
      </div>

      {children && <div className="timeline-activity-expanded">{children}</div>}
    </article>
  );
}
