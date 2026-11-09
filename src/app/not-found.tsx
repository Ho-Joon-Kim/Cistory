import { FileQuestion, Home } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function NotFound() {
  return (
    <main id="main" className="min-h-screen flex items-center justify-center p-4 bg-background">
      <Card className="max-w-md w-full">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 w-16 h-16 rounded-full bg-muted flex items-center justify-center">
            <FileQuestion aria-hidden="true" className="h-8 w-8 text-muted-foreground" />
          </div>
          <CardTitle>페이지를 찾을 수 없습니다</CardTitle>
        </CardHeader>
        <CardContent className="text-center space-y-4">
          <p className="text-muted-foreground">
            주소가 잘못되었거나 페이지가 이동되었습니다. 홈에서 다시 찾아 주세요.
          </p>
          <Button asChild>
            <Link href="/">
              <Home className="h-4 w-4 mr-2" />
              홈으로 돌아가기
            </Link>
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
