import { logger } from "@/lib/logger";

const BASE_URL = "https://wakatime.com/api/v1";

function sleepBackoff(attempt: number): Promise<void> {
  return new Promise((r) => setTimeout(r, 500 * 2 ** (attempt - 1)));
}

// ── Types (previously in ./interface.ts) ─────────────────────────────────────

export interface WakaTimeDuration {
  project: string | null;
  time: number;
  duration: number;
  humanAdditions: number | null;
  humanDeletions: number | null;
  aiAdditions: number | null;
  aiDeletions: number | null;
}

export interface WakaTimeSummaryItem {
  name: string;
  totalSeconds: number;
}

export interface WakaTimeDailySummary {
  date: string;
  grandTotalSeconds: number;
  projects: WakaTimeSummaryItem[];
  languages: WakaTimeSummaryItem[];
  editors: WakaTimeSummaryItem[];
  categories: WakaTimeSummaryItem[];
}

export interface WakaTimeUser {
  id: string;
  email: string;
  displayName: string;
}

// ── Adapter ──────────────────────────────────────────────────────────────────

export class WakaTimeAdapter {
  private authHeader: string;

  constructor(apiKey: string) {
    this.authHeader = `Basic ${Buffer.from(apiKey).toString("base64")}`;
  }

  private async fetchOnce(endpoint: string): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    try {
      return await fetch(`${BASE_URL}${endpoint}`, {
        headers: { Authorization: this.authHeader },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  private async parseOrThrow<T>(endpoint: string, response: Response): Promise<T> {
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      logger.error("WakaTime API error", {
        endpoint,
        status: response.status,
        body: text.slice(0, 200),
      });
      throw new Error(`WakaTime API error: ${response.status}`);
    }
    return (await response.json()) as T;
  }

  private async fetch<T>(endpoint: string): Promise<T> {
    const maxAttempts = 3;
    let lastError: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const response = await this.fetchOnce(endpoint);
        const retriable = response.status >= 500 || response.status === 429;
        if (retriable && attempt < maxAttempts) {
          lastError = new Error(`WakaTime API transient ${response.status}`);
          await sleepBackoff(attempt);
          continue;
        }
        return await this.parseOrThrow<T>(endpoint, response);
      } catch (err) {
        lastError = err;
        const transient =
          (err instanceof Error && err.name === "AbortError") || err instanceof TypeError;
        if (transient && attempt < maxAttempts) {
          await sleepBackoff(attempt);
          continue;
        }
        throw err;
      }
    }

    throw lastError instanceof Error ? lastError : new Error("WakaTime API failed");
  }

  async getDurations(date: string): Promise<WakaTimeDuration[]> {
    interface RawDuration {
      project: string | null;
      time: number;
      duration: number;
      human_additions?: number | null;
      human_deletions?: number | null;
      ai_additions?: number | null;
      ai_deletions?: number | null;
    }

    const data = await this.fetch<{ data: RawDuration[] }>(`/users/current/durations?date=${date}`);

    return data.data.map((d) => ({
      project: d.project,
      time: d.time,
      duration: d.duration,
      humanAdditions: d.human_additions ?? null,
      humanDeletions: d.human_deletions ?? null,
      aiAdditions: d.ai_additions ?? null,
      aiDeletions: d.ai_deletions ?? null,
    }));
  }

  async getSummaries(start: string, end: string): Promise<WakaTimeDailySummary[]> {
    interface RawSummaryItem {
      name: string;
      total_seconds: number;
    }
    interface RawDaySummary {
      range: { date: string };
      grand_total: { total_seconds: number };
      projects: RawSummaryItem[];
      languages: RawSummaryItem[];
      editors: RawSummaryItem[];
      categories: RawSummaryItem[];
    }

    const data = await this.fetch<{ data: RawDaySummary[] }>(
      `/users/current/summaries?start=${start}&end=${end}`
    );

    const mapItems = (items: RawSummaryItem[]) =>
      items.map((i) => ({ name: i.name, totalSeconds: i.total_seconds }));

    return data.data.map((d) => ({
      date: d.range.date,
      grandTotalSeconds: d.grand_total.total_seconds,
      projects: mapItems(d.projects),
      languages: mapItems(d.languages),
      editors: mapItems(d.editors),
      categories: mapItems(d.categories),
    }));
  }

  async verifyApiKey(): Promise<boolean> {
    try {
      await this.getCurrentUser();
      return true;
    } catch {
      return false;
    }
  }

  async getCurrentUser(): Promise<WakaTimeUser> {
    interface RawUser {
      id: string;
      email: string;
      display_name: string;
    }

    const data = await this.fetch<{ data: RawUser }>("/users/current");

    return {
      id: data.data.id,
      email: data.data.email,
      displayName: data.data.display_name,
    };
  }
}

export function createWakaTimeAdapter(apiKey: string): WakaTimeAdapter {
  return new WakaTimeAdapter(apiKey);
}
