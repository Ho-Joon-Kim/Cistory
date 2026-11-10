"use client";

import type { CSSProperties, ReactNode } from "react";
import { EvidenceScope, panelClass } from "@/components/ds";
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
      className={cn("ds-enter lg:border-t lg:border-line", className)}
      style={{ animationDelay: `${delay}ms` } as CSSProperties}
    >
      {children}
    </Tag>
  );
}

export function OverviewView({ model }: { model: OverviewModel }) {
  const { ctx } = model;
  return (
    <EvidenceScope>
      <Stage delay={100} className="mt-6 lg:mt-10 lg:pt-8" label="기간 요약">
        {model.headline ? (
          <p className="m-0 mb-5 max-w-[860px] font-serif text-[22px] leading-[30px] font-semibold tracking-[-0.02em] text-balance text-ink sm:text-2xl sm:leading-[34px]">
            {model.headline}
          </p>
        ) : null}
        <OverviewHero hero={model.hero} ctx={ctx} />
      </Stage>

      <Stage delay={200} className={cn(panelClass, "mt-3 lg:mt-14 lg:pt-8")}>
        <FlowChart flow={model.flow} label={ctx.label} />
      </Stage>

      {model.move || model.asset ? (
        <Stage
          delay={300}
          as="div"
          className="mt-3 grid grid-cols-1 gap-y-3 lg:mt-14 lg:grid-cols-2 lg:gap-x-16 lg:gap-y-14 lg:pt-8"
        >
          {model.move ? <MoveSection move={model.move} className={panelClass} /> : null}
          {model.asset ? (
            <div className={panelClass}>
              <AssetSection asset={model.asset} ctx={ctx} />
            </div>
          ) : null}
        </Stage>
      ) : null}

      {model.details.length > 0 ? (
        <Stage delay={400} as="div" className={cn(panelClass, "mt-3 lg:mt-14 lg:pt-8")}>
          <DetailsSection
            tabs={model.details}
            paymentRange={ctx.periodType === "year" ? null : { from: ctx.from, to: ctx.to }}
          />
        </Stage>
      ) : null}
    </EvidenceScope>
  );
}
