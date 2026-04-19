"use client";

import * as Sentry from "@sentry/nextjs";
import { AlertTriangle, Home, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

// biome-ignore lint/suspicious/noShadowRestrictedNames: Next.js App Router requires this export name
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
    console.error("Application error:", error);
  }, [error]);

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-background">
      <Card className="max-w-md w-full">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center">
            <AlertTriangle className="h-8 w-8 text-destructive" />
          </div>
          <CardTitle>문제가 발생했습니다</CardTitle>
        </CardHeader>
        <CardContent className="text-center space-y-4">
          <p className="text-muted-foreground">
            페이지를 불러오는 중 오류가 발생했습니다.
            <br />
            잠시 후 다시 시도해 주세요.
          </p>

          {process.env.NODE_ENV === "development" && error.message && (
            <pre className="text-xs bg-muted p-3 rounded-md text-left overflow-auto max-h-32">
              {error.message}
            </pre>
          )}

          <div className="flex gap-2 justify-center">
            <Button onClick={reset} variant="outline">
              <RefreshCw className="h-4 w-4 mr-2" />
              다시 시도
            </Button>
            <Button asChild>
              <Link href="/">
                <Home className="h-4 w-4 mr-2" />
                홈으로
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
