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

export interface YearlyReportData extends Omit<MonthlyReportData, "prevMonth" | "totalDaysInMonth"> {
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
