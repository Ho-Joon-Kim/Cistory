"use client";

import { Clock, Layers, Search, X } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { TimelineSegment } from "../utils";
import { LayersPanel, type LayerVisibility } from "./panels/LayersPanel";
import { SearchPanel } from "./panels/SearchPanel";
import { TimelinePanel } from "./panels/TimelinePanel";

type TabId = "layers" | "timeline" | "search";

const TABS: { id: TabId; icon: React.ReactNode; label: string }[] = [
  { id: "layers", icon: <Layers className="h-4 w-4" aria-hidden="true" />, label: "레이어" },
  { id: "timeline", icon: <Clock className="h-4 w-4" aria-hidden="true" />, label: "타임라인" },
  { id: "search", icon: <Search className="h-4 w-4" aria-hidden="true" />, label: "검색" },
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
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  // The icon button that opened the panel, so focus can return to it on close.
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const wasOpenRef = useRef(false);
  const panelId = useId();
  const titleId = useId();

  // Detect mobile breakpoint (below lg = 1024px)
  useEffect(() => {
    const mql = window.matchMedia("(max-width: 1023px)");
    setIsMobile(mql.matches);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, []);

  const handleTabClick = useCallback((tabId: TabId, trigger: HTMLButtonElement) => {
    triggerRef.current = trigger;
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

  // Escape closes the panel (mobile sheet and desktop side panel alike).
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setActiveTab(null);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [isOpen]);

  // Mobile sheet: move focus into the sheet on open, and back to the trigger on
  // close — but only when focus was inside the sheet (or dropped to <body>), so an
  // outside click on the map keeps focus where the user put it.
  useEffect(() => {
    if (isOpen && !wasOpenRef.current && isMobile) {
      closeButtonRef.current?.focus();
    }
    if (!isOpen && wasOpenRef.current) {
      const active = document.activeElement;
      if (!active || active === document.body || panelRef.current?.contains(active)) {
        triggerRef.current?.focus();
      }
    }
    wasOpenRef.current = isOpen;
  }, [isOpen, isMobile]);

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

  // Mobile: icons in map corner, sheet fixed to viewport
  if (isMobile) {
    return (
      <>
        {/* Icon bar at top-left of map (consistent with desktop) */}
        <div className="absolute inset-0 pointer-events-none z-20">
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
                onClick={(e) => handleTabClick(tab.id, e.currentTarget)}
                title={tab.label}
                aria-label={tab.label}
                aria-pressed={activeTab === tab.id}
                aria-controls={panelId}
              >
                {tab.icon}
              </button>
            ))}
          </div>
        </div>

        {/* Backdrop + bottom sheet rendered at viewport level (not clipped by map container) */}
        {isOpen && (
          <button
            type="button"
            aria-label="닫기"
            tabIndex={-1}
            className="fixed inset-0 z-40 bg-black/30 backdrop-blur-[1px]"
            onClick={handleClose}
          />
        )}
        <div
          ref={panelRef}
          id={panelId}
          role="dialog"
          aria-modal={isOpen}
          aria-labelledby={titleId}
          inert={!isOpen}
          className={`fixed bottom-0 left-0 right-0 z-50 bg-background/95 backdrop-blur border-t border-border/50 shadow-lg transition-transform duration-200 ease-out ${
            isOpen ? "translate-y-0" : "translate-y-full pointer-events-none"
          }`}
          style={{ maxHeight: "60vh" }}
        >
          <div className="flex items-center justify-between px-3 py-2 border-b border-border/30">
            <h2 id={titleId} className="text-xs font-medium text-muted-foreground">
              {TABS.find((t) => t.id === activeTab)?.label}
            </h2>
            <button
              ref={closeButtonRef}
              type="button"
              aria-label="닫기"
              className="h-6 w-6 flex items-center justify-center rounded hover:bg-accent"
              onClick={handleClose}
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
          <div className="overflow-y-auto" style={{ maxHeight: "calc(60vh - 36px)" }}>
            {panelContent}
          </div>
        </div>
      </>
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
            onClick={(e) => handleTabClick(tab.id, e.currentTarget)}
            title={tab.label}
            aria-label={tab.label}
            aria-pressed={activeTab === tab.id}
            aria-controls={panelId}
          >
            {tab.icon}
          </button>
        ))}
      </div>

      {/* Slide panel */}
      <div
        ref={panelRef}
        id={panelId}
        inert={!isOpen}
        className={`absolute top-3 bottom-3 left-[52px] w-[250px] bg-background/95 backdrop-blur border border-border/50 rounded-lg shadow-lg transition-[opacity,translate] duration-200 ease-out overflow-hidden ${
          isOpen
            ? "pointer-events-auto translate-x-0 opacity-100"
            : "pointer-events-none -translate-x-2 opacity-0"
        }`}
      >
        <div className="w-[250px] h-full overflow-y-auto">{panelContent}</div>
      </div>
    </div>
  );
}
