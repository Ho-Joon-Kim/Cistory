import { logger } from "@/lib/logger";
import type {
  WakaTimeAdapter,
  WakaTimeDailySummary,
  WakaTimeDuration,
  WakaTimeUser,
} from "./interface";

const BASE_URL = "https://wakatime.com/api/v1";

export class WakaTimeAdapterImpl implements WakaTimeAdapter {
  private authHeader: string;

  constructor(apiKey: string) {
    this.authHeader = `Basic ${Buffer.from(apiKey).toString("base64")}`;
  }

  private async fetch<T>(endpoint: string): Promise<T> {
    const url = `${BASE_URL}${endpoint}`;
    const response = await fetch(url, {
      headers: { Authorization: this.authHeader },
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      logger.error("WakaTime API error", {
        endpoint,
        status: response.status,
        body: text.slice(0, 200),
      });
      throw new Error(`WakaTime API error: ${response.status}`);
    }

    return response.json() as Promise<T>;
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
  return new WakaTimeAdapterImpl(apiKey);
}
