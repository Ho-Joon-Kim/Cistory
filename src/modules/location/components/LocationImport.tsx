"use client";

import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Upload, FileCheck, Loader2, AlertCircle } from "lucide-react";

interface ImportResult {
  format: string;
  imported: number;
  duplicates: number;
  totalParsed: number;
  dateRange: { from: string; to: string } | null;
}

export function LocationImport() {
  const [isUploading, setIsUploading] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleUpload = async (file: File) => {
    setIsUploading(true);
    setError(null);
    setResult(null);

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("format", "auto");

      const res = await fetch("/api/timeline/locations/import", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "임포트에 실패했습니다");
        return;
      }

      setResult(data as ImportResult);
    } catch {
      setError("네트워크 오류가 발생했습니다");
    } finally {
      setIsUploading(false);
    }
  };

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleUpload(file);
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
          GPX, GeoJSON, Google Takeout (Records.json) 파일을 업로드하세요.
          포맷은 자동으로 감지됩니다.
        </p>

        <input
          ref={fileInputRef}
          type="file"
          accept=".gpx,.geojson,.json"
          className="hidden"
          onChange={onFileChange}
        />

        <Button
          variant="outline"
          disabled={isUploading}
          onClick={() => fileInputRef.current?.click()}
        >
          {isUploading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
              임포트 중...
            </>
          ) : (
            <>
              <Upload className="h-4 w-4 mr-2" />
              파일 선택
            </>
          )}
        </Button>

        {error && (
          <div className="flex items-center gap-2 text-sm text-destructive">
            <AlertCircle className="h-4 w-4" />
            {error}
          </div>
        )}

        {result && (
          <div className="rounded-lg border p-3 space-y-1">
            <div className="flex items-center gap-2 text-sm font-medium text-green-600">
              <FileCheck className="h-4 w-4" />
              임포트 완료
            </div>
            <div className="text-sm text-muted-foreground space-y-0.5">
              <p>포맷: {result.format}</p>
              <p>파싱된 포인트: {result.totalParsed.toLocaleString()}개</p>
              <p>새로 저장: {result.imported.toLocaleString()}개</p>
              {result.duplicates > 0 && (
                <p>중복 건너뜀: {result.duplicates.toLocaleString()}개</p>
              )}
              {result.dateRange && (
                <p>날짜 범위: {result.dateRange.from} ~ {result.dateRange.to}</p>
              )}
            </div>
            {result.dateRange && result.imported > 0 && (
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
