"use client";

import type { ReactNode } from "react";

export type ActivityAccent = "location" | "movement" | "expense" | "income";

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
          <span className="timeline-activity-dot" />
          <span>{kind}</span>
          {chip && <span className="timeline-activity-chip">{chip}</span>}
        </div>
        <div className="timeline-activity-title">
          <span className="timeline-activity-icon">{icon}</span>
          <strong>{title}</strong>
        </div>
        <div className="timeline-activity-trailing">{trailing}</div>
      </div>

      <div className="timeline-activity-secondary">
        {detail && <div className="timeline-activity-detail">{detail}</div>}
        <div className="timeline-activity-stats">{stats}</div>
      </div>

      {children && <div className="timeline-activity-expanded">{children}</div>}
    </article>
  );
}
