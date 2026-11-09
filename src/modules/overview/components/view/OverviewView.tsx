"use client";

import type { CSSProperties, ReactNode } from "react";
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

export function OverviewView({ model }: { model: OverviewModel }) {
  const { ctx } = model;
  return (
    <EvidenceScope>
      <Stage delay={100} className="mt-8 pt-8 lg:mt-10" label="기간 요약">
        {model.headline ? (
          <p className="m-0 mb-8 max-w-[860px] font-serif text-[22px] leading-[30px] font-semibold tracking-[-0.02em] text-balance text-ink sm:text-2xl sm:leading-[34px]">
            {model.headline}
          </p>
        ) : null}
        <OverviewHero hero={model.hero} ctx={ctx} />
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
