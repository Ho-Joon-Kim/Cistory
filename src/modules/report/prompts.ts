/**
 * Report AI Narrative Prompts
 *
 * 월간/연간 보고서용 AI 회고문 프롬프트
 */

import type { MonthlyReportData, YearlyReportData } from "./types";

function formatSeconds(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return `${hours}시간 ${minutes}분`;
  return `${minutes}분`;
}

function formatMeters(meters: number): string {
  if (meters >= 1000) return `${(meters / 1000).toFixed(1)}km`;
  return `${Math.round(meters)}m`;
}

/**
 * 월간 보고서 AI 내러티브 프롬프트
 */
export function buildMonthlyNarrativePrompt(
  yearMonth: string,
  data: MonthlyReportData,
  commitSummaries: string[]
): string {
  const [year, month] = yearMonth.split("-");
  const topProjects = data.projectBreakdown.slice(0, 5);
  const topLanguages = data.languageBreakdown.slice(0, 5);
  const topPlaces = data.topPlaces.slice(0, 5);

  let prompt = `당신은 개발자의 월간 활동을 따뜻하고 격려하는 톤으로 회고해주는 작가입니다.

## ${year}년 ${month}월 활동 데이터

### 코딩 활동
- 총 커밋: ${data.totalCommits}개
- 코드 변경: +${data.totalAdditions} / -${data.totalDeletions}
- 활동일: ${data.activeDays}일 / ${data.totalDaysInMonth}일
- 최장 연속 활동: ${data.maxStreak}일
- 총 코딩 시간: ${formatSeconds(data.totalCodingSeconds)}`;

  if (topProjects.length > 0) {
    prompt += `\n\n### 주요 프로젝트`;
    for (const p of topProjects) {
      prompt += `\n- ${p.name}: 커밋 ${p.commits}개, +${p.additions}/-${p.deletions}`;
    }
  }

  if (topLanguages.length > 0) {
    prompt += `\n\n### 사용 언어`;
    for (const l of topLanguages) {
      prompt += `\n- ${l.name}: ${formatSeconds(l.seconds)}`;
    }
  }

  if (data.commitTypeBreakdown.length > 0) {
    prompt += `\n\n### 커밋 유형`;
    for (const t of data.commitTypeBreakdown) {
      prompt += `\n- ${t.type}: ${t.count}개`;
    }
  }

  if (data.totalDistanceMeters > 0) {
    prompt += `\n\n### 이동`;
    prompt += `\n- 총 이동거리: ${formatMeters(data.totalDistanceMeters)}`;
  }

  if (topPlaces.length > 0) {
    prompt += `\n\n### 주요 활동 장소`;
    for (const p of topPlaces) {
      prompt += `\n- ${p.placeName}${p.isOverseas ? " (해외)" : ""}: ${p.visitCount}회 방문, ${Math.round(p.totalMinutes)}분 체류`;
    }
  }

  if (data.overseasTrips.length > 0) {
    prompt += `\n\n### 해외여행`;
    for (const trip of data.overseasTrips) {
      prompt += `\n- ${trip.country}: ${trip.startDate} ~ ${trip.endDate} (${trip.places.join(", ")})`;
    }
  }

  if (data.prevMonth) {
    prompt += `\n\n### 전월 대비`;
    const commitDiff = data.totalCommits - data.prevMonth.totalCommits;
    const codingDiff = data.totalCodingSeconds - data.prevMonth.totalCodingSeconds;
    prompt += `\n- 커밋: ${commitDiff >= 0 ? "+" : ""}${commitDiff}개`;
    prompt += `\n- 코딩시간: ${codingDiff >= 0 ? "+" : ""}${formatSeconds(Math.abs(codingDiff))}`;
  }

  if (commitSummaries.length > 0) {
    prompt += `\n\n### 주요 커밋 요약 (일부)`;
    for (const s of commitSummaries.slice(0, 15)) {
      prompt += `\n- ${s}`;
    }
  }

  prompt += `

## 작성 규칙
1. 한국어로 2~3문단 작성
2. 비개발자도 이해할 수 있는 따뜻한 톤
3. 프로젝트별 주요 성과를 구체적으로 언급
4. 숫자 나열이 아닌, 이야기처럼 자연스럽게
5. 해외여행이 있었다면 자연스럽게 언급
6. 전월 대비 변화가 있으면 성장이나 변화를 격려
7. 마크다운 포맷팅 사용 가능 (볼드, 이탈릭 등)

회고문만 출력하세요.`;

  return prompt;
}

/**
 * 연간 보고서 AI 내러티브 프롬프트
 */
export function buildYearlyNarrativePrompt(
  year: string,
  data: YearlyReportData,
  monthlyNarratives: string[]
): string {
  const topProjects = data.projectBreakdown.slice(0, 8);

  let prompt = `당신은 개발자의 연간 활동을 따뜻하고 격려하는 톤으로 회고해주는 작가입니다.

## ${year}년 연간 활동 요약

### 전체 통계
- 총 커밋: ${data.totalCommits}개
- 코드 변경: +${data.totalAdditions} / -${data.totalDeletions}
- 활동일: ${data.activeDays}일
- 총 코딩 시간: ${formatSeconds(data.totalCodingSeconds)}
- 총 이동거리: ${formatMeters(data.totalDistanceMeters)}`;

  if (data.monthlyTrend.length > 0) {
    prompt += `\n\n### 월별 추이`;
    for (const m of data.monthlyTrend) {
      prompt += `\n- ${m.month}: 커밋 ${m.commits}개, 코딩 ${formatSeconds(m.codingSeconds)}, 활동 ${m.activeDays}일`;
    }
  }

  if (topProjects.length > 0) {
    prompt += `\n\n### 주요 프로젝트`;
    for (const p of topProjects) {
      prompt += `\n- ${p.name}: 커밋 ${p.commits}개`;
    }
  }

  if (data.projectTimeline.length > 0) {
    prompt += `\n\n### 프로젝트 타임라인`;
    for (const p of data.projectTimeline.slice(0, 10)) {
      prompt += `\n- ${p.name}: ${p.firstCommit} ~ ${p.lastCommit} (${p.totalCommits}개 커밋)`;
    }
  }

  if (data.newLanguages.length > 0) {
    prompt += `\n\n### 올해 새로 사용한 언어: ${data.newLanguages.join(", ")}`;
  }

  if (data.overseasTrips.length > 0) {
    prompt += `\n\n### 해외여행`;
    for (const trip of data.overseasTrips) {
      prompt += `\n- ${trip.country}: ${trip.startDate} ~ ${trip.endDate}`;
    }
  }

  if (data.prevYear) {
    prompt += `\n\n### 전년 대비`;
    const commitDiff = data.totalCommits - data.prevYear.totalCommits;
    prompt += `\n- 커밋: ${commitDiff >= 0 ? "+" : ""}${commitDiff}개`;
  }

  if (monthlyNarratives.length > 0) {
    prompt += `\n\n### 월간 회고 요약 (참고)`;
    for (const n of monthlyNarratives) {
      prompt += `\n---\n${n.slice(0, 300)}`;
    }
  }

  prompt += `

## 작성 규칙
1. 한국어로 3~4문단 작성
2. 한 해를 돌아보는 따뜻하고 격려하는 톤
3. 분기별 변화나 성장 포인트를 자연스럽게 언급
4. 프로젝트별 주요 성과를 구체적으로
5. 해외여행이 있었다면 개발 외 활동으로 언급
6. 전년 대비 성장을 격려
7. 마크다운 포맷팅 사용 가능

회고문만 출력하세요.`;

  return prompt;
}
