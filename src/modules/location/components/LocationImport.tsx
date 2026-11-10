"use client";

import { Loader2, Upload } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  PanelActions,
  PanelNote,
  PanelStats,
  PanelText,
} from "@/modules/settings/components/panel";

interface ImportProgress {
  phase: "uploading" | "parsing" | "inserting" | "done" | "error";
  progress: number; // 0-100
  detail: string;
  // Final result fields
  format?: string;
  totalParsed?: number;
  inserted?: number;
  duplicates?: number;
  dateRange?: { from: string; to: string } | null;
  error?: string;
}

interface ServerProgress {
  phase: "parsing" | "inserting" | "done" | "error";
  totalParsed?: number;
  inserted?: number;
  duplicates?: number;
  dateRange?: { from: string; to: string } | null;
  format?: string;
  progress?: number;
  error?: string;
}

const POLL_INTERVAL_MS = 1500;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

export function LocationImport() {
  const [state, setState] = useState<ImportProgress | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isActive =
    state?.phase === "uploading" || state?.phase === "parsing" || state?.phase === "inserting";

  const clearPollTimer = useCallback(() => {
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      clearPollTimer();
      abortRef.current?.abort();
    };
  }, [clearPollTimer]);

  const applyServerProgress = useCallback((data: ServerProgress) => {
    if (data.phase === "parsing") {
      setState({
        phase: "parsing",
        progress: 0,
        detail: data.format ? `${data.format} 분석 중…` : "파일 분석 중…",
        format: data.format,
        totalParsed: 0,
      });
    } else if (data.phase === "inserting") {
      const inserted = data.inserted ?? 0;
      const totalParsed = data.totalParsed ?? 0;
      setState({
        phase: "inserting",
        // Total is unknown while streaming; the bar is indeterminate.
        progress: 0,
        detail: `저장 중… ${inserted.toLocaleString()}개 저장 / ${totalParsed.toLocaleString()}개 스캔`,
        format: data.format,
        totalParsed,
        inserted,
        duplicates: data.duplicates ?? 0,
      });
    } else if (data.phase === "done") {
      setState({
        phase: "done",
        progress: 100,
        detail: "완료",
        format: data.format,
        totalParsed: data.totalParsed ?? 0,
        inserted: data.inserted ?? 0,
        duplicates: data.duplicates ?? 0,
        dateRange: data.dateRange ?? null,
      });
    } else if (data.phase === "error") {
      setState({
        phase: "error",
        progress: 0,
        detail: "",
        error: data.error ?? "파일을 가져오지 못했어요.",
      });
    }
  }, []);

  const pollJob = useCallback(
    async (jobId: string, signal: AbortSignal) => {
      try {
        const res = await fetch(
          `/api/timeline/locations/import?jobId=${encodeURIComponent(jobId)}`,
          { signal, cache: "no-store" }
        );
        if (signal.aborted) return;
        if (!res.ok) {
          // 404 likely means the job was garbage-collected — surface a clear error.
          const errBody = (await res.json().catch(() => ({}))) as { error?: string };
          setState({
            phase: "error",
            progress: 0,
            detail: "",
            error: errBody.error ?? "진행 상태를 확인하지 못했어요.",
          });
          return;
        }
        const data = (await res.json()) as ServerProgress;
        applyServerProgress(data);

        if (data.phase !== "done" && data.phase !== "error") {
          pollTimerRef.current = setTimeout(() => pollJob(jobId, signal), POLL_INTERVAL_MS);
        }
      } catch (e) {
        if (signal.aborted) return;
        // Transient network error — keep polling. Cloudflare hiccups on a
        // short GET shouldn't tear the whole import session down.
        console.warn("[import] poll failed, retrying", e);
        pollTimerRef.current = setTimeout(() => pollJob(jobId, signal), POLL_INTERVAL_MS);
      }
    },
    [applyServerProgress]
  );

  const handleUpload = useCallback(
    async (file: File) => {
      clearPollTimer();
      abortRef.current?.abort();
      const abort = new AbortController();
      abortRef.current = abort;

      setState({
        phase: "uploading",
        progress: 0,
        detail: `${file.name} (${formatBytes(file.size)}) 업로드 중…`,
      });

      try {
        const jobId = await new Promise<string>((resolve, reject) => {
          const xhr = new XMLHttpRequest();

          xhr.upload.addEventListener("progress", (e) => {
            if (!e.lengthComputable) return;
            const pct = Math.round((e.loaded / e.total) * 100);
            setState({
              phase: "uploading",
              progress: pct,
              detail: `업로드 중… ${formatBytes(e.loaded)} / ${formatBytes(e.total)} (${pct}%)`,
            });
          });

          xhr.upload.addEventListener("load", () => {
            // Upload finished; server is now spooling + responding.
            setState({
              phase: "uploading",
              progress: 100,
              detail: "업로드 완료, 처리 시작 대기 중…",
            });
          });

          xhr.addEventListener("load", () => {
            if (xhr.status >= 400) {
              try {
                const err = JSON.parse(xhr.responseText);
                reject(new Error(err.error ?? "파일을 업로드하지 못했어요."));
              } catch {
                reject(new Error("파일을 업로드하지 못했어요."));
              }
              return;
            }
            try {
              const body = JSON.parse(xhr.responseText) as { jobId?: string };
              if (!body.jobId) {
                reject(new Error("서버 응답을 확인하지 못했어요."));
                return;
              }
              resolve(body.jobId);
            } catch {
              reject(new Error("서버 응답을 확인하지 못했어요."));
            }
          });

          xhr.addEventListener("error", () => reject(new Error("네트워크에 연결하지 못했어요.")));
          xhr.addEventListener("abort", () => reject(new Error("취소됨")));

          xhr.open("POST", "/api/timeline/locations/import");
          xhr.setRequestHeader("Accept", "application/json");

          const formData = new FormData();
          formData.append("file", file);
          formData.append("format", "auto");
          xhr.send(formData);

          abort.signal.addEventListener("abort", () => xhr.abort());
        });

        // Kick off polling. pollJob reschedules itself until the job reaches
        // a terminal phase or the abort signal fires.
        void pollJob(jobId, abort.signal);
      } catch (e) {
        if (e instanceof Error && e.message === "취소됨") return;
        setState({
          phase: "error",
          progress: 0,
          detail: "",
          error: e instanceof Error ? e.message : "파일을 가져오지 못했어요.",
        });
      }
    },
    [clearPollTimer, pollJob]
  );

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleUpload(file);
    // Reset input so same file can be re-selected
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  return (
    <div className="flex flex-col gap-4">
      <PanelText>
        GPX, GeoJSON, Google Takeout(Records.json · 휴대폰 Takeout) 파일을 올리면 위치 기록에
        더해요. 큰 파일은 .gz로 압축하면 빨라요. 이미 있는 좌표는 건너뛰어요.
      </PanelText>

      <input
        ref={fileInputRef}
        type="file"
        accept=".gpx,.geojson,.json,.zip,.gz,.gpx.gz,.geojson.gz,.json.gz"
        className="hidden"
        onChange={onFileChange}
      />

      <PanelActions>
        <Button
          variant="outline"
          size="sm"
          disabled={isActive}
          onClick={() => fileInputRef.current?.click()}
        >
          {isActive ? (
            <Loader2 className="animate-spin" aria-hidden="true" />
          ) : (
            <Upload aria-hidden="true" />
          )}
          {isActive ? "처리 중…" : "파일 선택"}
        </Button>
      </PanelActions>

      {/* `uploading` is determinate (XHR upload progress); `parsing`/`inserting`
          are indeterminate because the streaming parser doesn't know the total
          point count up front. */}
      {isActive && state && (
        <div className="flex flex-col gap-2">
          <div className="h-1 w-full overflow-hidden rounded-full bg-track">
            {state.phase === "uploading" ? (
              <div
                className="h-full rounded-full bg-brand transition-[width] duration-300"
                style={{ width: `${state.progress}%` }}
              />
            ) : (
              <div className="h-full w-1/3 animate-pulse rounded-full bg-brand" />
            )}
          </div>
          <p className="m-0 text-xs leading-4 text-ink-3 tabular-nums" aria-live="polite">
            {state.detail}
          </p>
        </div>
      )}

      {state?.phase === "error" && (
        <div role="alert">
          <PanelNote tone="gain">{state.error} 파일을 다시 골라 주세요.</PanelNote>
        </div>
      )}

      {state?.phase === "done" && (
        <div className="flex flex-col gap-3">
          <PanelNote tone="brand">
            {state.format ? `${state.format} 파일을 ` : ""}가져왔어요
            {state.dateRange ? ` · ${state.dateRange.from} ~ ${state.dateRange.to}` : ""}
          </PanelNote>
          <PanelStats
            items={[
              { label: "읽은 좌표", value: state.totalParsed ?? 0, unit: "개" },
              { label: "새로 저장", value: state.inserted ?? 0, unit: "개" },
              {
                label: "중복 건너뜀",
                value: state.duplicates ?? 0,
                unit: "개",
                tone: (state.duplicates ?? 0) > 0 ? "ink" : "muted",
              },
            ]}
          />
          {state.dateRange && (state.inserted ?? 0) > 0 && (
            <PanelText className="text-ink-3">
              가져온 날짜는 위의 위치 처리에서 기간을 골라 다시 처리하면 방문·이동에 반영돼요.
            </PanelText>
          )}
        </div>
      )}
    </div>
  );
}
