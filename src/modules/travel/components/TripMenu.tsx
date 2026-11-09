"use client";

import * as PopoverPrimitive from "@radix-ui/react-popover";
import Link from "next/link";
import { type FormEvent, useState } from "react";
import { cn } from "@/lib/utils";
import { MoreIcon } from "./parts";

type View = "menu" | "confirm" | "rename";

const ITEM =
  "flex w-full cursor-pointer items-center gap-2.5 rounded-[7px] border-0 bg-transparent px-2.5 py-2 text-left text-[13px] leading-5 text-ink transition-colors duration-150 hover:bg-track focus-visible:bg-track focus-visible:outline-none";
const SMALL_BTN =
  "inline-flex h-[30px] cursor-pointer items-center rounded-control border px-3.5 text-[13px] font-semibold transition-[scale,box-shadow,background-color] duration-150 ease-out active:scale-[0.96] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand";

/**
 * The "…" menu of a trip: 자세히 보기 · 이름 바꾸기 · 여행 아님으로 표시. Both edits
 * happen inside the menu (a rename field, a confirm step), so nothing opens a
 * modal over the list.
 */
export function TripMenu({
  tripId,
  tripName,
  onRename,
  onNotTrip,
  detailHref,
  extra,
  triggerClassName,
  exclusionRadiusText = "10 km",
}: {
  tripId: string;
  tripName: string;
  onRename?: (name: string) => Promise<boolean>;
  onNotTrip: () => void;
  /** Omitted on the detail page itself. */
  detailHref?: string;
  /** Extra items above the separator (e.g. GPX export). */
  extra?: { label: string; onSelect: () => void }[];
  triggerClassName?: string;
  exclusionRadiusText?: string;
}) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>("menu");
  const [name, setName] = useState(tripName);
  const [saving, setSaving] = useState(false);

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) {
      setView("menu");
      setName(tripName);
    }
  };

  const submitRename = async (event: FormEvent) => {
    event.preventDefault();
    if (!onRename || !name.trim() || name.trim() === tripName) {
      setOpen(false);
      return;
    }
    setSaving(true);
    const ok = await onRename(name);
    setSaving(false);
    if (ok) setOpen(false);
  };

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <PopoverPrimitive.Trigger
        type="button"
        aria-label="여행 메뉴"
        className={cn(
          "inline-grid size-8 cursor-pointer place-items-center rounded-lg border-0 bg-transparent text-ink-2 transition-[background-color,scale] duration-150 ease-out hover:bg-track hover:text-ink active:scale-[0.96] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand max-sm:size-11",
          triggerClassName
        )}
      >
        <MoreIcon />
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align="end"
          sideOffset={4}
          collisionPadding={16}
          aria-label={`${tripName} 메뉴`}
          className="ds-pop z-50 flex w-[260px] origin-(--radix-popover-content-transform-origin) flex-col rounded-xl bg-surface p-1.5 shadow-pop outline-none"
        >
          {view === "menu" ? (
            <div role="menu" className="flex flex-col">
              {detailHref ? (
                <Link role="menuitem" href={detailHref} className={ITEM}>
                  자세히 보기
                </Link>
              ) : null}
              {onRename ? (
                <button
                  type="button"
                  role="menuitem"
                  className={ITEM}
                  onClick={() => setView("rename")}
                >
                  이름 바꾸기
                </button>
              ) : null}
              {extra?.map((item) => (
                <button
                  key={item.label}
                  type="button"
                  role="menuitem"
                  className={ITEM}
                  onClick={() => {
                    item.onSelect();
                    setOpen(false);
                  }}
                >
                  {item.label}
                </button>
              ))}
              <span aria-hidden="true" className="mx-1.5 my-1 h-px bg-line" />
              <button
                type="button"
                role="menuitem"
                className={cn(ITEM, "text-gain")}
                onClick={() => setView("confirm")}
              >
                여행 아님으로 표시
              </button>
            </div>
          ) : view === "confirm" ? (
            <div className="flex flex-col gap-2.5 px-2.5 pt-2 pb-1.5 text-[13px] leading-5 text-ink">
              <p className="m-0">
                이 여행을 지우고, 가장 오래 머문 곳 반경{" "}
                <span className="num">{exclusionRadiusText}</span>는 다음 감지부터 여행으로 보지
                않아요.
              </p>
              <span className="flex justify-end gap-2">
                <button
                  type="button"
                  className={cn(
                    SMALL_BTN,
                    "border-transparent bg-transparent text-ink-2 hover:bg-track"
                  )}
                  onClick={() => setView("menu")}
                >
                  취소
                </button>
                <button
                  type="button"
                  data-trip-id={tripId}
                  className={cn(
                    SMALL_BTN,
                    "border-[color-mix(in_oklab,var(--up)_38%,transparent)] bg-transparent text-gain"
                  )}
                  onClick={() => {
                    setOpen(false);
                    onNotTrip();
                  }}
                >
                  여행 아님
                </button>
              </span>
            </div>
          ) : (
            <form onSubmit={submitRename} className="flex flex-col gap-2.5 px-2.5 pt-2 pb-1.5">
              <label className="text-label" htmlFor={`rename-${tripId}`}>
                여행 이름
              </label>
              <input
                id={`rename-${tripId}`}
                // biome-ignore lint/a11y/noAutofocus: the field is the only thing in the opened menu
                autoFocus
                value={name}
                maxLength={60}
                onChange={(event) => setName(event.target.value)}
                className="h-9 rounded-control border-0 bg-page px-3 text-sm text-ink shadow-[inset_0_0_0_1px_var(--line)] outline-none focus-visible:shadow-[inset_0_0_0_1.5px_var(--brand)]"
              />
              <span className="flex justify-end gap-2">
                <button
                  type="button"
                  className={cn(
                    SMALL_BTN,
                    "border-transparent bg-transparent text-ink-2 hover:bg-track"
                  )}
                  onClick={() => setView("menu")}
                >
                  취소
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className={cn(
                    SMALL_BTN,
                    "border-transparent bg-brand text-brand-ink disabled:opacity-50"
                  )}
                >
                  저장
                </button>
              </span>
            </form>
          )}
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
