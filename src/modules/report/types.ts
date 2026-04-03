/**
 * Report Data Types
 */

// ==================== Section Types ====================

export interface CommitsSectionData {
  totalCommits: number;
  totalAdditions: number;
  totalDeletions: number;
  activeDays: number;
  totalDaysInMonth: number;
  maxStreak: number;
  commitsByDayOfWeek: number[]; // [일,월,화,수,목,금,토]
  commitsByHour: number[]; // 24개 (0~23시)
  dailyCommits: { date: string; count: number }[];
  commitTypeBreakdown: { type: string; count: number }[];
  projectBreakdown: { name: string; commits: number; additions: number; deletions: number }[];
  prevCommits?: { totalCommits: number; activeDays: number };
}

export interface CodingSectionData {
  totalCodingSeconds: number;
  dailyCodingSeconds: { date: string; seconds: number }[];
  languageBreakdown: { name: string; seconds: number }[];
  editorBreakdown: { name: string; seconds: number }[];
  aiCodeStats: { aiLines: number; humanLines: number };
  prevCodingSeconds?: number;
}

export interface LocationSectionData {
  totalDistanceMeters: number;
  dailyDistances: { date: string; meters: number }[];
  topPlaces: {
    placeName: string;
    address: string;
    category: string | null;
    visitCount: number;
    totalMinutes: number;
    lat: number;
    lon: number;
    isOverseas: boolean;
  }[];
  overseasTrips: { country: string; startDate: string; endDate: string; places: string[] }[];
  locationHeatmapPoints: { lat: number; lon: number; weight: number }[];
  prevDistanceMeters?: number;
  newCities?: { city: string; countryName: string; firstVisitDate: string }[];
  newCountries?: { countryName: string; firstVisitDate: string }[];
  trips?: {
    id: string;
    name: string;
    startDate: string;
    endDate: string;
    visitedCities: string[];
    visitedCountries: string[];
    isOverseas: boolean;
  }[];
}

// Yearly variants with extra fields
export interface YearlyCommitsSectionData extends CommitsSectionData {
  projectTimeline: {
    name: string;
    firstCommit: string;
    lastCommit: string;
    totalCommits: number;
  }[];
}

export interface YearlyCodingSectionData extends CodingSectionData {
  quarterlyLanguages: { quarter: string; languages: { name: string; seconds: number }[] }[];
  newLanguages: string[];
}

// ==================== Deep Reports Types ====================

export interface SparklineData {
  date: string;
  value: number;
}

export interface DeepWorkSession {
  date: string;
  project: string | null;
  durationSeconds: number;
  startedAt: string;
}

export interface WorkLifeBalanceMetrics {
  nightCommitRatio: number; // 22시~6시 커밋 비율
  weekendCommitRatio: number; // 토/일 커밋 비율
  balanceScore: number; // 0~100 점수
}

export interface ContextSwitchingMetrics {
  avgDailyProjects: number;
  avgDailyLanguages: number;
  focusScore: number; // 0~100 점수 (낮은 전환 = 높은 집중)
}

export interface PlaceProductivity {
  placeName: string;
  address: string;
  lat: number;
  lon: number;
  commitCount: number;
  codingSeconds: number;
  productivityScore: number; // 커밋 + 코딩시간 기반 점수
}

export interface RoutinePattern {
  dayOfWeek: number; // 0=일, 6=토
  dominantCategory: string;
  totalSeconds: number;
}

export interface EnrichedCommitsSectionData extends CommitsSectionData {
  mergeCommitCount: number;
  avgFilesChangedPerCommit: number;
  workLifeBalance: WorkLifeBalanceMetrics;
  sparklines: {
    commits: SparklineData[];
    activeDays: SparklineData[];
  };
  sameMonthLastYear?: { totalCommits: number; activeDays: number };
}

export interface EnrichedCodingSectionData extends CodingSectionData {
  categoryBreakdown: { name: string; seconds: number }[];
  projectCodingTime: { name: string; seconds: number }[];
  deepWorkSessions: DeepWorkSession[];
  deepWorkStats: {
    totalSessions: number;
    avgDurationSeconds: number;
    totalDeepWorkSeconds: number;
  };
  contextSwitching: ContextSwitchingMetrics;
  sparklines: {
    codingTime: SparklineData[];
  };
  sameMonthLastYear?: { totalCodingSeconds: number };
}

export interface EnrichedLocationSectionData extends LocationSectionData {
  topPlacesEnriched: PlaceProductivity[];
  sparklines: {
    distance: SparklineData[];
  };
  sameMonthLastYear?: { totalDistanceMeters: number };
}

export interface CrossAnalysisData {
  placeProductivity: PlaceProductivity[];
  routinePatterns: RoutinePattern[];
}

// ==================== Full Report Types (backward compat) ====================

export interface MonthlyReportData {
  // 커밋 통계
  totalCommits: number;
  totalAdditions: number;
  totalDeletions: number;
  activeDays: number;
  totalDaysInMonth: number;
  maxStreak: number;
  commitsByDayOfWeek: number[]; // [일,월,화,수,목,금,토]
  commitsByHour: number[]; // 24개 (0~23시)
  dailyCommits: { date: string; count: number }[];
  commitTypeBreakdown: { type: string; count: number }[];

  // 프로젝트별
  projectBreakdown: { name: string; commits: number; additions: number; deletions: number }[];

  // 코딩 통계 (WakaTime)
  totalCodingSeconds: number;
  dailyCodingSeconds: { date: string; seconds: number }[];
  languageBreakdown: { name: string; seconds: number }[];
  editorBreakdown: { name: string; seconds: number }[];
  aiCodeStats: { aiLines: number; humanLines: number };

  // 이동 통계
  totalDistanceMeters: number;
  dailyDistances: { date: string; meters: number }[];

  // 위치/여행
  topPlaces: {
    placeName: string;
    address: string;
    category: string | null;
    visitCount: number;
    totalMinutes: number;
    lat: number;
    lon: number;
    isOverseas: boolean;
  }[];
  overseasTrips: { country: string; startDate: string; endDate: string; places: string[] }[];
  locationHeatmapPoints: { lat: number; lon: number; weight: number }[];

  // 전월 대비
  prevMonth?: {
    totalCommits: number;
    totalCodingSeconds: number;
    totalDistanceMeters: number;
    activeDays: number;
  };
}

export interface YearlyReportData
  extends Omit<MonthlyReportData, "prevMonth" | "totalDaysInMonth"> {
  totalDaysInMonth: number; // 연간: 365/366
  monthlyTrend: {
    month: string;
    commits: number;
    codingSeconds: number;
    distanceMeters: number;
    activeDays: number;
  }[];
  projectTimeline: {
    name: string;
    firstCommit: string;
    lastCommit: string;
    totalCommits: number;
  }[];
  newLanguages: string[];
  quarterlyLanguages: { quarter: string; languages: { name: string; seconds: number }[] }[];
  prevYear?: {
    totalCommits: number;
    totalCodingSeconds: number;
    totalDistanceMeters: number;
    activeDays: number;
  };
}
