"use client";

import { Bot, ChevronDown, ChevronUp, Code, User } from "lucide-react";
import { useState } from "react";
import { formatCodingTime } from "@/lib/utils";
import { ActivityCard } from "@/modules/timeline/components/ActivityCard";
import type { CodingSessionData, CodingStatData } from "../hooks";

interface CodingSessionCardProps {
  sessions: CodingSessionData[];
  stats?: CodingStatData;
}

const LANGUAGE_COLORS = ["#8b5cf6", "#3b82f6", "#f59e0b"];

export function CodingSessionCard({ sessions, stats }: CodingSessionCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const totalSeconds =
    stats?.totalSeconds ?? sessions.reduce((sum, session) => sum + session.durationSeconds, 0);
  const projects = stats?.projects ?? deriveProjects(sessions);
  const topLanguages = (stats?.languages ?? []).slice(0, 3);
  const languageTotal = topLanguages.reduce((sum, language) => sum + language.totalSeconds, 0);
  const aiStats = sessions.reduce(
    (accumulator, session) => ({
      aiLines: accumulator.aiLines + (session.aiAdditions ?? 0) + (session.aiDeletions ?? 0),
      humanLines:
        accumulator.humanLines + (session.humanAdditions ?? 0) + (session.humanDeletions ?? 0),
    }),
    { aiLines: 0, humanLines: 0 }
  );
  const totalLines = aiStats.aiLines + aiStats.humanLines;
  const aiPercent = totalLines > 0 ? Math.round((aiStats.aiLines / totalLines) * 100) : 0;

  if (totalSeconds === 0 && sessions.length === 0) return null;

  const languageSummary = topLanguages.length > 0 && (
    <div className="coding-language-summary">
      <div className="coding-language-bar">
        {topLanguages.map((language, index) => (
          <span
            key={language.name}
            style={{
              width: `${languageTotal > 0 ? (language.totalSeconds / languageTotal) * 100 : 0}%`,
              backgroundColor: LANGUAGE_COLORS[index],
            }}
          />
        ))}
      </div>
      <div className="coding-language-legend">
        {topLanguages.map((language, index) => (
          <span key={language.name}>
            <i style={{ backgroundColor: LANGUAGE_COLORS[index] }} />
            {language.name}
          </span>
        ))}
      </div>
    </div>
  );

  return (
    <ActivityCard
      accent="coding"
      kind="코딩"
      chip={topLanguages[0]?.name}
      icon={<Code size={12} />}
      title="WakaTime"
      trailing={
        <span className="flex items-center gap-1.5">
          <strong>{formatCodingTime(totalSeconds)}</strong>
          {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </span>
      }
      detail={languageSummary || undefined}
      stats={<span>{sessions.length}개 세션</span>}
      expanded={isExpanded}
      onToggle={() => setIsExpanded((current) => !current)}
      toggleLabel={`코딩 세션 ${isExpanded ? "접기" : "펼치기"}`}
    >
      {isExpanded && (
        <div className="coding-expanded-grid">
          {projects.length > 0 && (
            <section>
              <h4>프로젝트별</h4>
              <div className="coding-detail-list">
                {projects.map((project) => (
                  <div key={project.name}>
                    <span>{project.name}</span>
                    <span>{formatCodingTime(project.totalSeconds)}</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {totalLines > 0 && (
            <section>
              <h4>코드 작성 비율</h4>
              <div className="coding-ratio-row">
                <div>
                  <span className="bg-violet-500" style={{ width: `${aiPercent}%` }} />
                  <span className="bg-emerald-500" style={{ width: `${100 - aiPercent}%` }} />
                </div>
                <span>
                  <Bot size={12} /> AI {aiPercent}%
                </span>
                <span>
                  <User size={12} /> 직접 {100 - aiPercent}%
                </span>
              </div>
            </section>
          )}

          {sessions.length > 0 && (
            <section>
              <h4>세션 기록</h4>
              <div className="coding-detail-list">
                {sessions.map((session) => (
                  <div key={session.id}>
                    <span>
                      {formatTime(session.startedAt)} {session.project}
                    </span>
                    <span>{formatCodingTime(session.durationSeconds)}</span>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </ActivityCard>
  );
}

function formatTime(value: string): string {
  const date = new Date(value);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function deriveProjects(sessions: CodingSessionData[]) {
  const projects = new Map<string, number>();
  for (const session of sessions) {
    const name = session.project ?? "Unknown";
    projects.set(name, (projects.get(name) ?? 0) + session.durationSeconds);
  }
  return Array.from(projects.entries())
    .map(([name, totalSeconds]) => ({ name, totalSeconds }))
    .sort((left, right) => right.totalSeconds - left.totalSeconds);
}
