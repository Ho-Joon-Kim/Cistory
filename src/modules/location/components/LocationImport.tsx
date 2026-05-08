"use client";

import { AlertCircle, FileCheck, Loader2, Upload } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

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

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

export function LocationImport() {
  const [state, setState] = useState<ImportProgress | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const isActive =
    state?.phase === "uploading" || state?.phase === "parsing" || state?.phase === "inserting";

  const handleSSEEvent = useCallback((data: Record<string, unknown>) => {
    const phase = data.phase as string;

    if (phase === "parsing") {
      const format = data.format as string | undefined;
      setState({
        phase: "parsing",
        progress: 0,
        detail: format ? `${format} 분석 중...` : "파일 분석 중...",
        format,
        totalParsed: 0,
      });
    } else if (phase === "inserting") {
      const inserted = (data.inserted as number) ?? 0;
      const totalParsed = (data.totalParsed as number) ?? 0;
      setState({
        phase: "inserting",
        // Total is unknown while streaming; the bar is indeterminate.
        progress: 0,
        detail: `저장 중... ${inserted.toLocaleString()}개 저장 / ${totalParsed.toLocaleString()}개 스캔`,
        format: data.format as string,
        totalParsed,
        inserted,
        duplicates: (data.duplicates as number) ?? 0,
      });
    } else if (phase === "done") {
      setState({
        phase: "done",
        progress: 100,
        detail: "완료",
        format: data.format as string,
        totalParsed: (data.totalParsed as number) ?? 0,
        inserted: (data.inserted as number) ?? 0,
        duplicates: (data.duplicates as number) ?? 0,
        dateRange: data.dateRange as { from: string; to: string } | null,
      });
    } else if (phase === "error") {
      setState({
        phase: "error",
        progress: 0,
        detail: "",
        error: (data.error as string) ?? "임포트 실패",
      });
    }
  }, []);

  const handleUpload = useCallback(
    async (file: File) => {
      const abort = new AbortController();
      abortRef.current = abort;

      setState({
        phase: "uploading",
        progress: 0,
        detail: `${file.name} (${formatBytes(file.size)}) 업로드 중...`,
      });

      try {
        // Upload with XMLHttpRequest for progress tracking
        const formData = new FormData();
        formData.append("file", file);
        formData.append("format", "auto");

        const _uploadProgress = await new Promise<void>((resolve, reject) => {
          const xhr = new XMLHttpRequest();

          xhr.upload.addEventListener("progress", (e) => {
            if (e.lengthComputable) {
              const pct = Math.round((e.loaded / e.total) * 100);
              setState({
                phase: "uploading",
                progress: pct,
                detail: `업로드 중... ${formatBytes(e.loaded)} / ${formatBytes(e.total)} (${pct}%)`,
              });
            }
          });

          xhr.addEventListener("load", () => {
            if (xhr.status >= 400) {
              // Non-SSE error response
              try {
                const err = JSON.parse(xhr.responseText);
                reject(new Error(err.error ?? "업로드 실패"));
              } catch {
                reject(new Error(`HTTP ${xhr.status}`));
              }
              return;
            }
            resolve();
          });

          xhr.addEventListener("error", () => reject(new Error("네트워크 오류")));
          xhr.addEventListener("abort", () => reject(new Error("취소됨")));

          // We need SSE streaming, but XMLHttpRequest can't handle SSE.
          // So we do a two-step approach:
          // 1. Use fetch for the actual request (SSE)
          // 2. Only use this for upload progress estimation

          // Actually, fetch doesn't support upload progress.
          // Use XMLHttpRequest with responseType to read SSE manually.
          xhr.open("POST", "/api/timeline/locations/import");
          xhr.setRequestHeader("Accept", "text/event-stream");
          xhr.send(formData);

          // Read SSE events as they arrive via onprogress
          let lastIndex = 0;
          xhr.addEventListener("progress", () => {
            const text = xhr.responseText.substring(lastIndex);
            lastIndex = xhr.responseText.length;

            const lines = text.split("\n");
            for (const line of lines) {
              if (!line.startsWith("data: ")) continue;
              try {
                const data = JSON.parse(line.slice(6));
                handleSSEEvent(data);
              } catch {
                // ignore parse errors
              }
            }
          });

          xhr.addEventListener("loadend", () => {
            // Process any remaining data
            const text = xhr.responseText.substring(lastIndex);
            const lines = text.split("\n");
            for (const line of lines) {
              if (!line.startsWith("data: ")) continue;
              try {
                const data = JSON.parse(line.slice(6));
                handleSSEEvent(data);
              } catch {
                // ignore
              }
            }
          });

          // Don't resolve/reject from upload events — the SSE handler will set final state
          // We just need to wait for loadend
          xhr.addEventListener("loadend", () => resolve());

          abort.signal.addEventListener("abort", () => xhr.abort());
        });
      } catch (e) {
        if (e instanceof Error && e.message === "취소됨") return;
        setState({
          phase: "error",
          progress: 0,
          detail: "",
          error: e instanceof Error ? e.message : "알 수 없는 오류",
        });
      }
    },
    [handleSSEEvent]
  );

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleUpload(file);
    // Reset input so same file can be re-selected
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Upload className="h-4 w-4" />
          위치 데이터 임포트
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          GPX, GeoJSON, Google Takeout (Records.json / Phone Takeout) 파일을 업로드하세요. 큰
          파일은 <code className="text-xs">.gz</code>로 압축해서 올리면 빠릅니다.
        </p>

        <input
          ref={fileInputRef}
          type="file"
          accept=".gpx,.geojson,.json,.zip,.gz,.gpx.gz,.geojson.gz,.json.gz"
          className="hidden"
          onChange={onFileChange}
        />

        <Button variant="outline" disabled={isActive} onClick={() => fileInputRef.current?.click()}>
          {isActive ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
              처리 중...
            </>
          ) : (
            <>
              <Upload className="h-4 w-4 mr-2" />
              파일 선택
            </>
          )}
        </Button>

        {/* Progress bar — `uploading` is determinate (XHR upload progress);
            `parsing`/`inserting` are indeterminate because the streaming parser
            doesn't know the total point count up front. */}
        {isActive && state && (
          <div className="space-y-2">
            <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
              {state.phase === "uploading" ? (
                <div
                  className="h-full rounded-full bg-primary transition-all duration-300"
                  style={{ width: `${state.progress}%` }}
                />
              ) : (
                <div className="h-full w-1/3 rounded-full bg-primary animate-pulse" />
              )}
            </div>
            <p className="text-xs text-muted-foreground">{state.detail}</p>
          </div>
        )}

        {/* Error */}
        {state?.phase === "error" && (
          <div className="flex items-center gap-2 text-sm text-destructive">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {state.error}
          </div>
        )}

        {/* Success result */}
        {state?.phase === "done" && (
          <div className="rounded-lg border p-3 space-y-1">
            <div className="flex items-center gap-2 text-sm font-medium text-green-600">
              <FileCheck className="h-4 w-4" />
              임포트 완료
            </div>
            <div className="text-sm text-muted-foreground space-y-0.5">
              <p>포맷: {state.format}</p>
              <p>파싱된 포인트: {state.totalParsed?.toLocaleString()}개</p>
              <p>새로 저장: {state.inserted?.toLocaleString()}개</p>
              {(state.duplicates ?? 0) > 0 && (
                <p>중복 건너뜀: {state.duplicates?.toLocaleString()}개</p>
              )}
              {state.dateRange && (
                <p>
                  날짜 범위: {state.dateRange.from} ~ {state.dateRange.to}
                </p>
              )}
            </div>
            {state.dateRange && (state.inserted ?? 0) > 0 && (
              <p className="text-xs text-muted-foreground mt-2">
                설정 &gt; 위치 백필에서 임포트된 날짜의 분석을 실행하세요.
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
