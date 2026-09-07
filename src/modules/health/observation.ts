import type { ActivityCorrelationDay } from "./types";

/** Describe measured days; do not infer a trend, causation, or coding consistency. */
export function activityObservation(days: ActivityCorrelationDay[]): string | null {
  const measured = days.filter((day) => day.steps != null && Number.isFinite(day.steps));
  if (measured.length < 2) return null;
  const hi = measured.reduce((a, b) => (b.visits > a.visits ? b : a));
  const lo = measured.reduce((a, b) => (b.visits < a.visits ? b : a));
  if (hi.visits === lo.visits) return null;
  return `${hi.day}에는 ${hi.visits}곳 방문·${hi.steps!.toLocaleString("ko-KR")}보, ${lo.day}에는 ${lo.visits}곳 방문·${lo.steps!.toLocaleString("ko-KR")}보가 기록되었습니다. 이 두 날의 비교만으로 활동 간 연관성을 판단할 수 없습니다.`;
}
