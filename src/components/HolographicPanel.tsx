"use client";

import type { ReactNode } from "react";

interface HolographicPanelProps {
  children: ReactNode;
  className?: string;
}

export function HolographicPanel({ children, className }: HolographicPanelProps) {
  return (
    <div className={`ds-holo-panel ds-holo-flicker ${className ?? ""}`}>
      {/* Layer 1: Translucent gradient background + blur */}
      <div className="ds-holo-bg" />
      {/* Layer 2: Noise texture */}
      <div className="ds-holo-noise-layer" />
      {/* Layer 3: Dot matrix */}
      <div className="ds-holo-dots-layer" />
      {/* Layer 4: Scanlines */}
      <div className="ds-holo-scanlines-layer" />
      {/* Layer 5: Chromatic top edge */}
      <div className="ds-holo-chromatic-line" />
      {/* Layer 6: Chromatic bottom edge */}
      <div className="ds-holo-chromatic-line ds-holo-chromatic-bottom" />
      {/* Layer 7: Edge shimmer animation */}
      <div className="ds-holo-shimmer-line" />
      {/* Content (highest z) */}
      <div className="relative z-[5] h-full">{children}</div>
    </div>
  );
}
