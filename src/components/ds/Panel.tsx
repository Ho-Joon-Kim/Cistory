import type { ComponentPropsWithoutRef, ElementType, ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Section panel class. Below lg it turns a top-level page section into a surface
 * card (16px radius and padding, ring edge, 12px between adjacent panels); from
 * lg up it is inert and the cardless desktop layout stays. Rules live in
 * globals.css (`.ds-panel`), unlayered so they win over the section's desktop
 * spacing utilities. Use it on the section element itself — or on each column of
 * a multi-column desktop row, so every domain becomes its own card on phones.
 * Never nest panels.
 */
export const panelClass = "ds-panel";

type PanelProps<T extends ElementType> = {
  as?: T;
  children: ReactNode;
  className?: string;
} & Omit<ComponentPropsWithoutRef<T>, "as" | "children" | "className">;

/** `<section class="ds-panel">` — a page section that is a card on phones/tablets. */
export function Panel<T extends ElementType = "section">({
  as,
  children,
  className,
  ...rest
}: PanelProps<T>) {
  const Tag: ElementType = as ?? "section";
  return (
    <Tag className={cn(panelClass, className)} {...rest}>
      {children}
    </Tag>
  );
}
