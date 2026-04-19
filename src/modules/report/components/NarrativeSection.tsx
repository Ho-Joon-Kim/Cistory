"use client";

import { Sparkles } from "lucide-react";
import { useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";

interface NarrativeSectionProps {
  narrative: string;
}

function parseMarkdownInline(text: string): React.ReactNode[] {
  const result: React.ReactNode[] = [];
  const regex = /(\*\*(.+?)\*\*|\*(.+?)\*)/g;

  let lastIndex = 0;
  let match: RegExpExecArray | null;

  // biome-ignore lint/suspicious/noAssignInExpressions: standard regex.exec iteration idiom
  while ((match = regex.exec(text)) !== null) {
    // Text before the match
    if (match.index > lastIndex) {
      result.push(text.slice(lastIndex, match.index));
    }

    if (match[2]) {
      // Bold: **text**
      result.push(
        <strong key={match.index} className="font-semibold">
          {match[2]}
        </strong>
      );
    } else if (match[3]) {
      // Italic: *text*
      result.push(
        <em key={match.index} className="italic">
          {match[3]}
        </em>
      );
    }

    lastIndex = match.index + match[0].length;
  }

  // Remaining text
  if (lastIndex < text.length) {
    result.push(text.slice(lastIndex));
  }

  return result.length > 0 ? result : [text];
}

export function NarrativeSection({ narrative }: NarrativeSectionProps) {
  const paragraphs = useMemo(() => {
    return narrative
      .split(/\n\n+/)
      .map((p) => p.trim())
      .filter((p) => p.length > 0);
  }, [narrative]);

  if (!narrative.trim()) return null;

  return (
    <Card className="bg-muted/30 dark:bg-muted/10">
      <CardContent className="space-y-4">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Sparkles className="h-4 w-4 text-primary" />
          <span className="font-medium">AI 리포트 요약</span>
        </div>
        <div className="space-y-3">
          {paragraphs.map((paragraph) => (
            <p
              key={`para-${paragraph.slice(0, 30)}`}
              className="text-sm leading-relaxed text-foreground/90"
            >
              {parseMarkdownInline(paragraph)}
            </p>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
