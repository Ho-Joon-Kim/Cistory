"use client";

import { Bot, ChevronDown, ChevronUp, Code, User } from "lucide-react";
import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { formatCodingTime } from "@/modules/timeline/utils";
import type { CodingSessionData, CodingStatData } from "../hooks";

interface CodingSessionCardProps {
  sessions: CodingSessionData[];
  stats?: CodingStatData;
}

export function CodingSessionCard({ sessions, stats }: CodingSessionCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  // Fallback: compute total from sessions if stats not available
  const totalSeconds =
    stats?.totalSeconds ?? sessions.reduce((sum, s) => sum + s.durationSeconds, 0);
  if (totalSeconds === 0 && sessions.length === 0) return null;

  // Derive projects from sessions when stats unavailable
  const projects = stats?.projects ?? deriveProjects(sessions);

  // Top 3 languages
  const topLanguages = (stats?.languages ?? []).slice(0, 3);
  const langTotal = topLanguages.reduce((sum, l) => sum + l.totalSeconds, 0);

  // AI/Human code ratio from sessions
  const aiStats = sessions.reduce(
    (acc, s) => ({
      aiLines: acc.aiLines + (s.aiAdditions ?? 0) + (s.aiDeletions ?? 0),
      humanLines: acc.humanLines + (s.humanAdditions ?? 0) + (s.humanDeletions ?? 0),
    }),
    { aiLines: 0, humanLines: 0 }
  );
  const hasAiRatio = aiStats.aiLines > 0 || aiStats.humanLines > 0;
  const totalLines = aiStats.aiLines + aiStats.humanLines;
  const aiPercent = totalLines > 0 ? Math.round((aiStats.aiLines / totalLines) * 100) : 0;

  return (
    <Card
      className="cursor-pointer !py-0 !gap-0 rounded-lg relative overflow-hidden mb-2"
      onClick={() => setIsExpanded(!isExpanded)}
    >
      {/* Purple left border (WakaTime brand) */}
      <div className="absolute left-0 top-0 bottom-0 w-[3px] bg-violet-500" />

      <CardContent className="py-2 pl-4 pr-3">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Code className="h-4 w-4 text-violet-500 flex-shrink-0" />
            <span className="font-medium text-sm">Coding</span>
            <span className="font-bold text-sm">{formatCodingTime(totalSeconds)}</span>
            {sessions.length > 0 && (
              <span className="text-xs text-muted-foreground">{sessions.length}개 세션</span>
            )}
          </div>
          {isExpanded ? (
            <ChevronUp className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          )}
        </div>

        {/* Language bars (always visible) */}
        {topLanguages.length > 0 && (
          <div className="mt-2 flex items-center gap-1.5">
            <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden flex">
              {topLanguages.map((lang, i) => (
                <div
                  key={lang.name}
                  className="h-full transition-all duration-300"
                  style={{
                    width: `${langTotal > 0 ? (lang.totalSeconds / langTotal) * 100 : 0}%`,
                    backgroundColor: LANG_COLORS[i],
                  }}
                />
              ))}
            </div>
            <div className="flex items-center gap-1.5 flex-shrink-0">
              {topLanguages.map((lang, i) => (
                <span
                  key={lang.name}
                  className="flex items-center gap-0.5 text-[10px] text-muted-foreground"
                >
                  <span
                    className="w-1.5 h-1.5 rounded-full"
                    style={{ backgroundColor: LANG_COLORS[i] }}
                  />
                  {lang.name}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Expanded: project breakdown + AI ratio */}
        {isExpanded && (
          <div className="mt-3 pt-3 border-t animate-in fade-in-0 slide-in-from-top-2 duration-200 space-y-3">
            {/* Projects */}
            {projects.length > 0 && (
              <div>
                <h4 className="text-xs font-medium text-muted-foreground mb-1.5">프로젝트별</h4>
                <div className="space-y-1">
                  {projects.map((project) => (
                    <div key={project.name} className="flex items-center justify-between text-xs">
                      <span className="text-foreground truncate mr-2">{project.name}</span>
                      <span className="text-muted-foreground flex-shrink-0">
                        {formatCodingTime(project.totalSeconds)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* AI / Human ratio */}
            {hasAiRatio && (
              <div>
                <h4 className="text-xs font-medium text-muted-foreground mb-1.5">코드 작성 비율</h4>
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden flex">
                    <div
                      className="h-full bg-violet-500 transition-all duration-300"
                      style={{ width: `${aiPercent}%` }}
                    />
                    <div
                      className="h-full bg-emerald-500 transition-all duration-300"
                      style={{ width: `${100 - aiPercent}%` }}
                    />
                  </div>
                  <div className="flex items-center gap-2 text-[10px] text-muted-foreground flex-shrink-0">
                    <span className="flex items-center gap-0.5">
                      <Bot className="h-3 w-3 text-violet-500" />
                      AI {aiPercent}%
                    </span>
                    <span className="flex items-center gap-0.5">
                      <User className="h-3 w-3 text-emerald-500" />
                      직접 {100 - aiPercent}%
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* Session list */}
            {sessions.length > 0 && (
              <div>
                <h4 className="text-xs font-medium text-muted-foreground mb-1.5">세션 기록</h4>
                <div className="space-y-0.5">
                  {sessions.map((session) => {
                    const time = new Date(session.startedAt).toLocaleTimeString("ko-KR", {
                      hour: "2-digit",
                      minute: "2-digit",
                    });
                    return (
                      <div key={session.id} className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-1.5 truncate mr-2">
                          <span className="text-muted-foreground">{time}</span>
                          {session.project && (
                            <span className="text-foreground truncate">{session.project}</span>
                          )}
                        </div>
                        <span className="text-muted-foreground flex-shrink-0">
                          {formatCodingTime(session.durationSeconds)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

const LANG_COLORS = ["#8b5cf6", "#3b82f6", "#f59e0b"];

function deriveProjects(sessions: CodingSessionData[]) {
  const map = new Map<string, number>();
  for (const s of sessions) {
    const name = s.project ?? "Unknown";
    map.set(name, (map.get(name) ?? 0) + s.durationSeconds);
  }
  return Array.from(map.entries())
    .map(([name, totalSeconds]) => ({ name, totalSeconds }))
    .sort((a, b) => b.totalSeconds - a.totalSeconds);
}
