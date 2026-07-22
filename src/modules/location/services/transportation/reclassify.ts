import { detectAndPersistTracks } from "../track-persister";

export const MAX_TRANSPORTATION_RECLASSIFY_DAYS = 366;

interface PersistResult {
  trackCount: number;
  segmentCount: number;
}

type TrackDetector = (userId: string, date: string) => Promise<PersistResult>;

export interface TransportationReclassificationSummary {
  from: string;
  to: string;
  daysProcessed: number;
  trackCount: number;
  segmentCount: number;
}

export class TransportationReclassificationValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TransportationReclassificationValidationError";
  }
}

export class TransportationReclassificationError extends Error {
  readonly failedDate: string;
  readonly daysProcessed: number;
  readonly trackCount: number;
  readonly segmentCount: number;

  constructor(
    failedDate: string,
    summary: Omit<TransportationReclassificationSummary, "from" | "to">,
    cause: unknown
  ) {
    const causeMessage = cause instanceof Error ? cause.message : String(cause);
    super(`${failedDate} 교통수단 재분류 실패: ${causeMessage}`, { cause });
    this.name = "TransportationReclassificationError";
    this.failedDate = failedDate;
    this.daysProcessed = summary.daysProcessed;
    this.trackCount = summary.trackCount;
    this.segmentCount = summary.segmentCount;
  }
}

function parseDate(date: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) {
    throw new TransportationReclassificationValidationError("날짜는 YYYY-MM-DD 형식이어야 합니다");
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw new TransportationReclassificationValidationError("유효하지 않은 날짜입니다");
  }
  return parsed;
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export async function reclassifyTransportationRange(
  userId: string,
  from: string,
  to: string,
  detectTracks: TrackDetector = detectAndPersistTracks
): Promise<TransportationReclassificationSummary> {
  if (!userId) {
    throw new TransportationReclassificationValidationError("인증된 사용자가 필요합니다");
  }

  const fromDate = parseDate(from);
  const toDate = parseDate(to);
  if (fromDate > toDate) {
    throw new TransportationReclassificationValidationError("from은 to보다 이전이어야 합니다");
  }

  const dayCount = Math.floor((toDate.getTime() - fromDate.getTime()) / 86_400_000) + 1;
  if (dayCount > MAX_TRANSPORTATION_RECLASSIFY_DAYS) {
    throw new TransportationReclassificationValidationError(
      `재분류 범위는 최대 ${MAX_TRANSPORTATION_RECLASSIFY_DAYS}일입니다`
    );
  }

  const summary: TransportationReclassificationSummary = {
    from,
    to,
    daysProcessed: 0,
    trackCount: 0,
    segmentCount: 0,
  };

  for (let offset = 0; offset < dayCount; offset++) {
    const date = new Date(fromDate.getTime() + offset * 86_400_000);
    const dateString = formatDate(date);
    try {
      const result = await detectTracks(userId, dateString);
      summary.daysProcessed++;
      summary.trackCount += result.trackCount;
      summary.segmentCount += result.segmentCount;
    } catch (error) {
      throw new TransportationReclassificationError(dateString, summary, error);
    }
  }

  return summary;
}
