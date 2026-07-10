/**
 * Report AI Narrative Prompts
 *
 * 월간/연간 보고서용 AI 회고문 프롬프트
 */

import type {
  BodySectionData,
  ContextSwitchingMetrics,
  EnrichedCodingSectionData,
  MonthlyReportData,
  PlaceProductivity,
  RoutinePattern,
  WorkLifeBalanceMetrics,
  YearlyReportData,
} from "./types";

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
 * Low-cost body-composition block, appended only when the period actually has
 * measurements. Change is stated as a neutral first→last delta (no good/bad
 * framing) so the narrative doesn't editorialize weight.
 */
function buildBodyBlock(body: BodySectionData): string {
  if (body.measurementCount === 0) return "";
  const one = (v: number | null, unit: string) => (v == null ? "-" : `${v.toFixed(1)}${unit}`);
  const signed = (v: number | null, unit: string) =>
    v == null ? "-" : `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(1)}${unit}`;

  let block = "\n\n### 체성분 (Withings)";
  block += `\n- 측정 횟수: ${body.measurementCount}회`;
  block += `\n- 평균 체중: ${one(body.avgWeightKg, "kg")} (기간 변화 ${signed(body.weightChangeKg, "kg")})`;
  if (body.avgFatRatioPct != null) {
    block += `\n- 평균 체지방률: ${one(body.avgFatRatioPct, "%")} (변화 ${signed(body.fatRatioChangePct, "%")})`;
  }
  if (body.avgMuscleMassKg != null) {
    block += `\n- 평균 근육량: ${one(body.avgMuscleMassKg, "kg")} (변화 ${signed(body.muscleChangeKg, "kg")})`;
  }
  if (body.weightMinKg != null && body.weightMaxKg != null) {
    block += `\n- 체중 범위: ${one(body.weightMinKg, "kg")} ~ ${one(body.weightMaxKg, "kg")}`;
  }
  return block;
}

/**
 * 월간 보고서 AI 내러티브 프롬프트
 */
export function buildMonthlyNarrativePrompt(
  yearMonth: string,
  data: MonthlyReportData,
  commitSummaries: string[],
  enriched?: {
    workLifeBalance?: WorkLifeBalanceMetrics;
    deepWorkStats?: EnrichedCodingSectionData["deepWorkStats"];
    categoryBreakdown?: { name: string; seconds: number }[];
    contextSwitching?: ContextSwitchingMetrics;
    placeProductivity?: PlaceProductivity[];
    routinePatterns?: RoutinePattern[];
    body?: BodySectionData;
  }
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
    prompt += "\n\n### 주요 프로젝트";
    for (const p of topProjects) {
      prompt += `\n- ${p.name}: 커밋 ${p.commits}개, +${p.additions}/-${p.deletions}`;
    }
  }

  if (topLanguages.length > 0) {
    prompt += "\n\n### 사용 언어";
    for (const l of topLanguages) {
      prompt += `\n- ${l.name}: ${formatSeconds(l.seconds)}`;
    }
  }

  if (data.commitTypeBreakdown.length > 0) {
    prompt += "\n\n### 커밋 유형";
    for (const t of data.commitTypeBreakdown) {
      prompt += `\n- ${t.type}: ${t.count}개`;
    }
  }

  if (data.totalDistanceMeters > 0) {
    prompt += "\n\n### 이동";
    prompt += `\n- 총 이동거리: ${formatMeters(data.totalDistanceMeters)}`;
  }

  if (topPlaces.length > 0) {
    prompt += "\n\n### 주요 활동 장소";
    for (const p of topPlaces) {
      prompt += `\n- ${p.placeName}${p.isOverseas ? " (해외)" : ""}: ${p.visitCount}회 방문, ${Math.round(p.totalMinutes)}분 체류`;
    }
  }

  if (data.overseasTrips.length > 0) {
    prompt += "\n\n### 해외여행";
    for (const trip of data.overseasTrips) {
      prompt += `\n- ${trip.country}: ${trip.startDate} ~ ${trip.endDate} (${trip.places.join(", ")})`;
    }
  }

  if (data.newCities && data.newCities.length > 0) {
    prompt += "\n\n### 처음 방문한 곳";
    for (const c of data.newCities) {
      prompt += `\n- ${c.city} (${c.countryName}): ${c.firstVisitDate}`;
    }
  }

  if (data.trips && data.trips.length > 0) {
    prompt += "\n\n### 여행";
    for (const t of data.trips) {
      prompt += `\n- ${t.name}: ${t.startDate} ~ ${t.endDate}${t.isOverseas ? " (해외)" : ""} — ${t.visitedCities.join(", ")}`;
    }
  }

  if (data.prevMonth) {
    prompt += "\n\n### 전월 대비";
    const commitDiff = data.totalCommits - data.prevMonth.totalCommits;
    const codingDiff = data.totalCodingSeconds - data.prevMonth.totalCodingSeconds;
    prompt += `\n- 커밋: ${commitDiff >= 0 ? "+" : ""}${commitDiff}개`;
    prompt += `\n- 코딩시간: ${codingDiff >= 0 ? "+" : ""}${formatSeconds(Math.abs(codingDiff))}`;
  }

  if (commitSummaries.length > 0) {
    prompt += "\n\n### 주요 커밋 요약 (일부)";
    for (const s of commitSummaries.slice(0, 15)) {
      prompt += `\n- ${s}`;
    }
  }

  // Enriched sections
  if (enriched?.workLifeBalance) {
    const wlb = enriched.workLifeBalance;
    prompt += "\n\n### 워크라이프 밸런스";
    prompt += `\n- 야간(22시~6시) 커밋 비율: ${Math.round(wlb.nightCommitRatio * 100)}%`;
    prompt += `\n- 주말 커밋 비율: ${Math.round(wlb.weekendCommitRatio * 100)}%`;
    prompt += `\n- 밸런스 점수: ${wlb.balanceScore}/100`;
  }

  if (enriched?.deepWorkStats && enriched.deepWorkStats.totalSessions > 0) {
    const dw = enriched.deepWorkStats;
    prompt += "\n\n### 딥워크 활동";
    prompt += `\n- 딥워크 세션 수: ${dw.totalSessions}회 (2시간+ 연속 코딩)`;
    prompt += `\n- 평균 딥워크 시간: ${formatSeconds(dw.avgDurationSeconds)}`;
    prompt += `\n- 총 딥워크 시간: ${formatSeconds(dw.totalDeepWorkSeconds)}`;
  }

  if (enriched?.categoryBreakdown && enriched.categoryBreakdown.length > 0) {
    prompt += "\n\n### 코딩 활동 유형";
    for (const cat of enriched.categoryBreakdown.slice(0, 5)) {
      prompt += `\n- ${cat.name}: ${formatSeconds(cat.seconds)}`;
    }
  }

  if (enriched?.contextSwitching) {
    const cs = enriched.contextSwitching;
    prompt += "\n\n### 집중도 지표";
    prompt += `\n- 하루 평균 프로젝트 수: ${cs.avgDailyProjects}개`;
    prompt += `\n- 하루 평균 언어 수: ${cs.avgDailyLanguages}개`;
    prompt += `\n- 집중도 점수: ${cs.focusScore}/100`;
  }

  if (enriched?.placeProductivity && enriched.placeProductivity.length > 0) {
    prompt += "\n\n### 장소별 생산성";
    for (const p of enriched.placeProductivity.slice(0, 3)) {
      prompt += `\n- ${p.placeName}: 커밋 ${p.commitCount}개, 코딩 ${formatSeconds(p.codingSeconds)}, 생산성 ${p.productivityScore}점`;
    }
  }

  if (enriched?.routinePatterns && enriched.routinePatterns.length > 0) {
    const dayNames = ["일", "월", "화", "수", "목", "금", "토"];
    prompt += "\n\n### 요일별 활동 패턴";
    for (const rp of enriched.routinePatterns) {
      prompt += `\n- ${dayNames[rp.dayOfWeek]}요일: ${rp.dominantCategory} (${formatSeconds(rp.totalSeconds)})`;
    }
  }

  if (enriched?.body) {
    prompt += buildBodyBlock(enriched.body);
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
8. 딥워크/집중도가 있으면 흐름과 몰입 경험을 언급
9. 장소별 생산성 차이가 있으면 공간과 생산성의 관계 인사이트
10. 워라밸 점수가 낮으면(60 이하) 적절한 휴식 격려, 높으면 칭찬
11. 요일별 패턴이 있으면 루틴의 리듬감 언급
12. 체성분 데이터가 있으면 건강 리듬을 담백하게 언급 (체중 증감에 좋다/나쁘다 가치판단 금지)

회고문만 출력하세요.`;

  return prompt;
}

/**
 * 연간 보고서 AI 내러티브 프롬프트
 */
export function buildYearlyNarrativePrompt(
  year: string,
  data: YearlyReportData,
  monthlyNarratives: string[],
  enriched?: {
    workLifeBalance?: WorkLifeBalanceMetrics;
    deepWorkStats?: EnrichedCodingSectionData["deepWorkStats"];
    categoryBreakdown?: { name: string; seconds: number }[];
    contextSwitching?: ContextSwitchingMetrics;
    placeProductivity?: PlaceProductivity[];
    routinePatterns?: RoutinePattern[];
    body?: BodySectionData;
  }
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
    prompt += "\n\n### 월별 추이";
    for (const m of data.monthlyTrend) {
      prompt += `\n- ${m.month}: 커밋 ${m.commits}개, 코딩 ${formatSeconds(m.codingSeconds)}, 활동 ${m.activeDays}일`;
    }
  }

  if (topProjects.length > 0) {
    prompt += "\n\n### 주요 프로젝트";
    for (const p of topProjects) {
      prompt += `\n- ${p.name}: 커밋 ${p.commits}개`;
    }
  }

  if (data.projectTimeline.length > 0) {
    prompt += "\n\n### 프로젝트 타임라인";
    for (const p of data.projectTimeline.slice(0, 10)) {
      prompt += `\n- ${p.name}: ${p.firstCommit} ~ ${p.lastCommit} (${p.totalCommits}개 커밋)`;
    }
  }

  if (data.newLanguages.length > 0) {
    prompt += `\n\n### 올해 새로 사용한 언어: ${data.newLanguages.join(", ")}`;
  }

  if (data.overseasTrips.length > 0) {
    prompt += "\n\n### 해외여행";
    for (const trip of data.overseasTrips) {
      prompt += `\n- ${trip.country}: ${trip.startDate} ~ ${trip.endDate}`;
    }
  }

  if (data.newCities && data.newCities.length > 0) {
    prompt += `\n\n### 올해 처음 방문한 곳 (${data.newCities.length}곳)`;
    for (const c of data.newCities.slice(0, 10)) {
      prompt += `\n- ${c.city} (${c.countryName})`;
    }
  }

  if (data.trips && data.trips.length > 0) {
    prompt += `\n\n### 여행 (${data.trips.length}건)`;
    for (const t of data.trips) {
      prompt += `\n- ${t.name}: ${t.startDate} ~ ${t.endDate}${t.isOverseas ? " (해외)" : ""} — ${t.visitedCities.join(", ")}`;
    }
  }

  if (data.prevYear) {
    prompt += "\n\n### 전년 대비";
    const commitDiff = data.totalCommits - data.prevYear.totalCommits;
    prompt += `\n- 커밋: ${commitDiff >= 0 ? "+" : ""}${commitDiff}개`;
  }

  if (monthlyNarratives.length > 0) {
    prompt += "\n\n### 월간 회고 요약 (참고)";
    for (const n of monthlyNarratives) {
      prompt += `\n---\n${n.slice(0, 300)}`;
    }
  }

  // Enriched sections
  if (enriched?.workLifeBalance) {
    const wlb = enriched.workLifeBalance;
    prompt += "\n\n### 워크라이프 밸런스";
    prompt += `\n- 야간(22시~6시) 커밋 비율: ${Math.round(wlb.nightCommitRatio * 100)}%`;
    prompt += `\n- 주말 커밋 비율: ${Math.round(wlb.weekendCommitRatio * 100)}%`;
    prompt += `\n- 밸런스 점수: ${wlb.balanceScore}/100`;
  }

  if (enriched?.deepWorkStats && enriched.deepWorkStats.totalSessions > 0) {
    const dw = enriched.deepWorkStats;
    prompt += "\n\n### 딥워크 활동";
    prompt += `\n- 딥워크 세션 수: ${dw.totalSessions}회`;
    prompt += `\n- 평균 딥워크 시간: ${formatSeconds(dw.avgDurationSeconds)}`;
    prompt += `\n- 총 딥워크 시간: ${formatSeconds(dw.totalDeepWorkSeconds)}`;
  }

  if (enriched?.categoryBreakdown && enriched.categoryBreakdown.length > 0) {
    prompt += "\n\n### 코딩 활동 유형";
    for (const cat of enriched.categoryBreakdown.slice(0, 5)) {
      prompt += `\n- ${cat.name}: ${formatSeconds(cat.seconds)}`;
    }
  }

  if (enriched?.contextSwitching) {
    const cs = enriched.contextSwitching;
    prompt += "\n\n### 집중도 지표";
    prompt += `\n- 하루 평균 프로젝트 수: ${cs.avgDailyProjects}개`;
    prompt += `\n- 집중도 점수: ${cs.focusScore}/100`;
  }

  if (enriched?.placeProductivity && enriched.placeProductivity.length > 0) {
    prompt += "\n\n### 장소별 생산성";
    for (const p of enriched.placeProductivity.slice(0, 3)) {
      prompt += `\n- ${p.placeName}: 커밋 ${p.commitCount}개, 코딩 ${formatSeconds(p.codingSeconds)}`;
    }
  }

  if (enriched?.body) {
    prompt += buildBodyBlock(enriched.body);
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
8. 딥워크/집중도가 있으면 흐름과 몰입 경험을 언급
9. 워라밸 점수가 낮으면 적절한 휴식 격려
10. 장소별 생산성 차이가 있으면 공간과 작업의 관계 인사이트
11. 체성분 데이터가 있으면 한 해의 건강 리듬을 담백하게 언급 (체중 증감에 좋다/나쁘다 가치판단 금지)

회고문만 출력하세요.`;

  return prompt;
}
