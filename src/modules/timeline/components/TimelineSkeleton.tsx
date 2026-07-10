"use client";

const SKELETON_GROUPS = [
  { id: "today", cardCount: 3 },
  { id: "previous", cardCount: 2 },
  { id: "older", cardCount: 2 },
];
const SKELETON_CARDS = ["first", "second", "third"];

export function TimelineSkeleton() {
  return (
    <output className="timeline-master-feed relative block space-y-4" aria-label="타임라인 로딩 중">
      <div className="timeline-master-line" aria-hidden="true" />
      {SKELETON_GROUPS.map(({ id, cardCount }, groupIndex) => (
        <div key={id} className="relative">
          <div className="commit-day-header flex">
            <span
              className={`commit-day-dot animate-pulse ${groupIndex === 0 ? "is-today" : ""}`}
            />
            <span className="h-4 w-20 animate-pulse rounded bg-muted" />
            <span className="h-5 w-14 animate-pulse rounded-full bg-muted" />
          </div>

          <div className="space-y-1">
            {SKELETON_CARDS.slice(0, cardCount).map((cardId) => (
              <div key={`${id}-${cardId}`} className="activity-timeline-row">
                <span className="activity-timeline-node animate-pulse" />
                <div className="activity-timeline-body">
                  <div className="timeline-activity-card">
                    <div className="timeline-activity-main">
                      <div className="h-4 w-16 animate-pulse rounded bg-muted" />
                      <div className="h-5 w-2/3 animate-pulse rounded bg-muted" />
                      <div className="h-4 w-14 animate-pulse rounded bg-muted" />
                    </div>
                    <div className="timeline-activity-secondary">
                      <div className="h-3 flex-1 animate-pulse rounded bg-muted/70" />
                      <div className="h-3 w-32 animate-pulse rounded bg-muted/70" />
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </output>
  );
}
