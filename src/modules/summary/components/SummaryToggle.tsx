"use client";

import { Toggle } from "@/components/ui/toggle";
import { User, Code } from "lucide-react";

interface SummaryToggleProps {
  mode: "technical" | "nonTechnical";
  onModeChange: (mode: "technical" | "nonTechnical") => void;
  size?: "sm" | "default" | "lg";
}

export function SummaryToggle({
  mode,
  onModeChange,
  size = "sm",
}: SummaryToggleProps) {
  return (
    <div className="flex items-center gap-1 border rounded-md p-0.5">
      <Toggle
        pressed={mode === "nonTechnical"}
        onPressedChange={() => onModeChange("nonTechnical")}
        size={size}
        className="data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
        aria-label="비기술자 관점으로 보기"
      >
        <User className="h-3 w-3 mr-1" />
        <span className="text-xs">비기술자</span>
      </Toggle>
      <Toggle
        pressed={mode === "technical"}
        onPressedChange={() => onModeChange("technical")}
        size={size}
        className="data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
        aria-label="기술자 관점으로 보기"
      >
        <Code className="h-3 w-3 mr-1" />
        <span className="text-xs">기술자</span>
      </Toggle>
    </div>
  );
}
