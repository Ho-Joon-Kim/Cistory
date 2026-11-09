"use client";

import { type CSSProperties, type ReactNode, useId, useState } from "react";
import { EvidenceScope } from "@/components/ds";
import { cn } from "@/lib/utils";
import type { OverviewModel } from "@/modules/overview/view/model";
import { FlowChart } from "./FlowChart";
import { OverviewHero } from "./OverviewHero";
import { AssetSection, DetailsSection, MoveSection } from "./Sections";

function Stage({
  delay,
  children,
  className,
  as: Tag = "section",
  label,
}: {
  delay: number;
  children: ReactNode;
  className?: string;
  as?: "section" | "div";
  label?: string;
}) {
  return (
    <Tag
      aria-label={label}
      className={cn("ds-enter border-t border-line", className)}
      style={{ animationDelay: `${delay}ms` } as CSSProperties}
    >
      {children}
    </Tag>
  );
}

/** The stored AI narrative, folded away: the facts above already carry the story. */
function NarrativeContext({ label, content }: { label: string; content: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div className="mt-6">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border-0 bg-transparent px-0 text-[13px] font-medium text-ink-2 hover:text-ink focus-visible:outline-2 focus-visible:outline-brand"
      >
        <svg
          aria-hidden="true"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={cn("text-ink-3 transition-[rotate] duration-150", open && "rotate-90")}
        >
          <path d="M9 18l6-6-6-6" />
        </svg>
        {label}의 맥락
      </button>
      {open ? (
        <div
          id={id}
          className="ds-reveal mt-1 max-w-[760px] text-sm leading-6 whitespace-pre-wrap text-pretty text-ink-2"
        >
          {content}
        </div>
      ) : null}
    </div>
  );
}

export function OverviewView({
  model,
  narrative,
}: {
  model: OverviewModel;
  narrative: string | null;
}) {
  const { ctx } = model;
  return (
    <EvidenceScope>
      <Stage delay={100} className="mt-8 pt-8 lg:mt-10" label="기간 요약">
        {model.headline ? (
          <p className="m-0 mb-8 max-w-[860px] font-serif text-xl leading-[30px] font-semibold tracking-[-0.02em] text-balance text-ink sm:text-2xl sm:leading-[34px]">
            {model.headline}
          </p>
        ) : null}
        <OverviewHero hero={model.hero} ctx={ctx} />
        {narrative ? <NarrativeContext label={ctx.label} content={narrative} /> : null}
      </Stage>

      <Stage delay={200} className="mt-14 pt-8">
        <FlowChart flow={model.flow} label={ctx.label} />
      </Stage>

      {model.move || model.asset ? (
        <Stage
          delay={300}
          as="div"
          className="mt-14 grid grid-cols-1 gap-y-14 pt-8 lg:grid-cols-2 lg:gap-x-16"
        >
          {model.move ? <MoveSection move={model.move} /> : null}
          {model.asset ? (
            <div className={cn(model.move && "border-t border-line pt-8 lg:border-t-0 lg:pt-0")}>
              <AssetSection asset={model.asset} ctx={ctx} />
            </div>
          ) : null}
        </Stage>
      ) : null}

      {model.details.length > 0 ? (
        <Stage delay={400} as="div" className="mt-14 pt-8">
          <DetailsSection tabs={model.details} />
        </Stage>
      ) : null}
    </EvidenceScope>
  );
}
