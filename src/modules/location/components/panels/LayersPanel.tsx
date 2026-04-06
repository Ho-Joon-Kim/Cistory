"use client";

import { Switch } from "@/components/ui/switch";
import { Route, MapPin, Bookmark, Palette, Eye } from "lucide-react";

export interface LayerVisibility {
  routes: boolean;
  stayPoints: boolean;
  savedPlaces: boolean;
  speedColors: boolean;
  fogOfWar: boolean;
}

interface LayersPanelProps {
  visibility: LayerVisibility;
  onVisibilityChange: (key: keyof LayerVisibility, value: boolean) => void;
}

const LAYER_OPTIONS: {
  key: keyof LayerVisibility;
  label: string;
  icon: React.ReactNode;
}[] = [
  { key: "routes", label: "경로", icon: <Route className="h-4 w-4" /> },
  { key: "stayPoints", label: "체류 포인트", icon: <MapPin className="h-4 w-4" /> },
  { key: "savedPlaces", label: "저장 장소", icon: <Bookmark className="h-4 w-4" /> },
  { key: "speedColors", label: "속도 색상", icon: <Palette className="h-4 w-4" /> },
  { key: "fogOfWar", label: "전쟁의 안개", icon: <Eye className="h-4 w-4" /> },
];

export function LayersPanel({ visibility, onVisibilityChange }: LayersPanelProps) {
  return (
    <div className="flex flex-col gap-1 p-3">
      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
        레이어
      </h3>
      {LAYER_OPTIONS.map((opt) => (
        <label
          key={opt.key}
          className="flex items-center justify-between gap-3 rounded-md px-2 py-2 hover:bg-accent/50 transition-colors cursor-pointer"
        >
          <div className="flex items-center gap-2.5">
            <span className="text-muted-foreground">{opt.icon}</span>
            <span className="text-sm">{opt.label}</span>
          </div>
          <Switch
            size="sm"
            checked={visibility[opt.key]}
            onCheckedChange={(checked) => onVisibilityChange(opt.key, checked)}
          />
        </label>
      ))}
    </div>
  );
}
