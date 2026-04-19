"use client";

import { Clock, Layers, Search, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { TimelineSegment } from "../utils";
import { LayersPanel, type LayerVisibility } from "./panels/LayersPanel";
import { SearchPanel } from "./panels/SearchPanel";
import { TimelinePanel } from "./panels/TimelinePanel";

type TabId = "layers" | "timeline" | "search";

const TABS: { id: TabId; icon: React.ReactNode; label: string }[] = [
  { id: "layers", icon: <Layers className="h-4 w-4" />, label: "레이어" },
  { id: "timeline", icon: <Clock className="h-4 w-4" />, label: "타임라인" },
  { id: "search", icon: <Search className="h-4 w-4" />, label: "검색" },
];

interface MapSidePanelProps {
  layerVisibility: LayerVisibility;
  onLayerVisibilityChange: (key: keyof LayerVisibility, value: boolean) => void;
  segments: TimelineSegment[];
  selectedSegmentIndex: number | null;
  onSegmentClick: (index: number) => void;
  onPlaceSelect: (place: { lat: number; lon: number; name: string }) => void;
}

export function MapSidePanel({
  layerVisibility,
  onLayerVisibilityChange,
  segments,
  selectedSegmentIndex,
  onSegmentClick,
  onPlaceSelect,
}: MapSidePanelProps) {
  const [activeTab, setActiveTab] = useState<TabId | null>(null);
  const [isMobile, setIsMobile] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const iconBarRef = useRef<HTMLDivElement>(null);

  // Detect mobile breakpoint (below lg = 1024px)
  useEffect(() => {
    const mql = window.matchMedia("(max-width: 1023px)");
    setIsMobile(mql.matches);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, []);

  const handleTabClick = useCallback((tabId: TabId) => {
    setActiveTab((prev) => (prev === tabId ? null : tabId));
  }, []);

  const handleClose = useCallback(() => {
    setActiveTab(null);
  }, []);

  // Click outside to close panel
  useEffect(() => {
    if (activeTab === null) return;

    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        panelRef.current &&
        !panelRef.current.contains(target) &&
        iconBarRef.current &&
        !iconBarRef.current.contains(target)
      ) {
        setActiveTab(null);
      }
    };

    // Delay to avoid closing on the same click that opens
    const timeout = setTimeout(() => {
      document.addEventListener("mousedown", handler);
    }, 0);

    return () => {
      clearTimeout(timeout);
      document.removeEventListener("mousedown", handler);
    };
  }, [activeTab]);

  const isOpen = activeTab !== null;

  const panelContent = (
    <>
      {activeTab === "layers" && (
        <LayersPanel visibility={layerVisibility} onVisibilityChange={onLayerVisibilityChange} />
      )}
      {activeTab === "timeline" && (
        <TimelinePanel
          segments={segments}
          selectedIndex={selectedSegmentIndex}
          onSegmentClick={onSegmentClick}
        />
      )}
      {activeTab === "search" && <SearchPanel onPlaceSelect={onPlaceSelect} />}
    </>
  );

  // Mobile: bottom sheet
  if (isMobile) {
    return (
      <div className="absolute inset-0 pointer-events-none z-20">
        {/* Icon bar at bottom-left */}
        <div
          ref={iconBarRef}
          className="pointer-events-auto absolute bottom-14 left-3 flex flex-row gap-1.5"
        >
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={`flex h-9 w-9 items-center justify-center rounded-lg border shadow-sm transition-colors ${
                activeTab === tab.id
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background/90 backdrop-blur text-muted-foreground border-border/50 hover:bg-accent"
              }`}
              onClick={() => handleTabClick(tab.id)}
              title={tab.label}
            >
              {tab.icon}
            </button>
          ))}
        </div>

        {/* Bottom sheet */}
        <div
          ref={panelRef}
          className={`pointer-events-auto absolute bottom-0 left-0 right-0 bg-background/95 backdrop-blur border-t border-border/50 shadow-lg transition-transform duration-200 ease-out ${
            isOpen ? "translate-y-0" : "translate-y-full"
          }`}
          style={{ maxHeight: "50vh" }}
        >
          <div className="flex items-center justify-between px-3 py-2 border-b border-border/30">
            <span className="text-xs font-medium text-muted-foreground">
              {TABS.find((t) => t.id === activeTab)?.label}
            </span>
            <button
              type="button"
              className="h-6 w-6 flex items-center justify-center rounded hover:bg-accent"
              onClick={handleClose}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="overflow-y-auto" style={{ maxHeight: "calc(50vh - 36px)" }}>
            {panelContent}
          </div>
        </div>
      </div>
    );
  }

  // Desktop: side panel
  return (
    <div className="absolute inset-0 pointer-events-none z-20">
      {/* Icon bar */}
      <div
        ref={iconBarRef}
        className="pointer-events-auto absolute top-3 left-3 flex flex-col gap-1.5"
      >
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={`flex h-9 w-9 items-center justify-center rounded-lg border shadow-sm transition-colors ${
              activeTab === tab.id
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-background/90 backdrop-blur text-muted-foreground border-border/50 hover:bg-accent"
            }`}
            onClick={() => handleTabClick(tab.id)}
            title={tab.label}
          >
            {tab.icon}
          </button>
        ))}
      </div>

      {/* Slide panel */}
      <div
        ref={panelRef}
        className={`pointer-events-auto absolute top-3 bottom-3 bg-background/95 backdrop-blur border border-border/50 rounded-lg shadow-lg transition-all duration-200 ease-out overflow-hidden ${
          isOpen ? "left-[52px] w-[250px] opacity-100" : "left-[52px] w-0 opacity-0"
        }`}
      >
        <div className="w-[250px] h-full overflow-y-auto">{panelContent}</div>
      </div>
    </div>
  );
}
