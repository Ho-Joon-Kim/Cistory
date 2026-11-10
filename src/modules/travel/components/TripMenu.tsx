"use client";

import * as PopoverPrimitive from "@radix-ui/react-popover";
import Link from "next/link";
import {
  type FormEvent,
  Fragment,
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import { menuItemClass, menuItemDangerClass } from "@/components/ds";
import { cn } from "@/lib/utils";
import { MoreIcon } from "./parts";

type View = "menu" | "confirm" | "rename";

const MENU_KEYS: Record<string, number | "first" | "last"> = {
  ArrowDown: 1,
  ArrowUp: -1,
  Home: "first",
  End: "last",
};

type Item = {
  key: string;
  label: ReactNode;
  danger?: boolean;
  href?: string;
  onSelect?: () => void;
};
const SMALL_BTN =
  "inline-flex h-[30px] max-sm:h-11 [@media(pointer:coarse)]:h-11 cursor-pointer items-center rounded-control border px-3.5 text-[13px] font-semibold transition-[scale,box-shadow,background-color] duration-150 ease-out active:scale-[0.96] focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-brand";

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
  exclusionRadiusText = "10km",
  tripLabel = tripName,
}: {
  tripId: string;
  tripName: string;
  /** Names the trip in the trigger's label; add the dates where names repeat. */
  tripLabel?: string;
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
  // Roving focus (APG menu): one item is in the tab order; arrows/Home/End move it.
  const [active, setActive] = useState(0);
  const menuRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  // A Tab close has already moved focus on; Radix must not pull it back to ⋯.
  const closedByTab = useRef(false);
  // Set when a sub-view's 취소 returns to the list, so focus lands back on its item.
  const refocusMenu = useRef(false);

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) {
      closedByTab.current = false;
      setView("menu");
      setName(tripName);
      setActive(0);
    }
  };

  const items: Item[] = [
    ...(detailHref ? [{ key: "detail", label: "자세히 보기", href: detailHref }] : []),
    ...(onRename
      ? [{ key: "rename", label: "이름 바꾸기", onSelect: () => setView("rename") }]
      : []),
    ...(extra ?? []).map((item) => ({
      key: `extra:${item.label}`,
      label: item.label,
      onSelect: () => {
        item.onSelect();
        setOpen(false);
      },
    })),
    {
      key: "not-trip",
      label: "여행 아님으로 표시",
      danger: true,
      onSelect: () => setView("confirm"),
    },
  ];

  const itemEls = () =>
    Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);

  const moveTo = (index: number) => {
    const els = itemEls();
    if (els.length === 0) return;
    const next = (index + els.length) % els.length;
    setActive(next);
    els[next]?.focus();
  };

  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // APG menu: Tab/Shift+Tab close the menu and focus moves on from the trigger.
    // The trigger is focused first (no default prevented), so the browser's own
    // Tab step continues from it rather than from the portaled menu.
    if (event.key === "Tab") {
      closedByTab.current = true;
      triggerRef.current?.focus();
      setOpen(false);
      return;
    }
    const step = MENU_KEYS[event.key];
    if (step === undefined) return;
    event.preventDefault();
    const current = itemEls().indexOf(document.activeElement as HTMLElement);
    const from = current === -1 ? active : current;
    moveTo(step === "first" ? 0 : step === "last" ? -1 : from + step);
  };

  // Focus follows the view: the confirm step opens on 취소 (the safe choice), and
  // 취소 in a sub-view returns focus to the item that opened it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs on view changes only
  useEffect(() => {
    if (view === "confirm") cancelRef.current?.focus();
    if (view === "menu" && refocusMenu.current) {
      refocusMenu.current = false;
      itemEls()[active]?.focus();
    }
  }, [view]);

  const backToMenu = () => {
    refocusMenu.current = true;
    setView("menu");
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
        ref={triggerRef}
        type="button"
        aria-label={`${tripLabel} 여행 메뉴`}
        className={cn(
          "inline-grid size-8 cursor-pointer place-items-center rounded-lg border-0 bg-transparent text-ink-2 transition-[background-color,scale] duration-150 ease-out hover:bg-track hover:text-ink active:scale-[0.96] focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-brand max-sm:size-11",
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
          // Radix skips links when it picks the first focusable, and only the
          // roving item is tabbable — so place focus on the first item ourselves.
          onOpenAutoFocus={(event) => {
            const first = menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]');
            if (!first) return;
            event.preventDefault();
            first.focus();
          }}
          onCloseAutoFocus={(event) => {
            if (!closedByTab.current) return;
            closedByTab.current = false;
            event.preventDefault();
          }}
          aria-label={`${tripName} 메뉴`}
          className="ds-pop z-50 flex w-[260px] origin-(--radix-popover-content-transform-origin) flex-col rounded-xl bg-surface p-1.5 shadow-pop outline-none"
        >
          {view === "menu" ? (
            <div
              ref={menuRef}
              role="menu"
              aria-label={`${tripName} 메뉴`}
              aria-orientation="vertical"
              className="flex flex-col"
              onKeyDown={onMenuKeyDown}
            >
              {items.map((item, i) => {
                const className = item.danger ? menuItemDangerClass : menuItemClass;
                const common = {
                  role: "menuitem",
                  tabIndex: i === active ? 0 : -1,
                  className,
                  onFocus: () => setActive(i),
                } as const;
                return (
                  <Fragment key={item.key}>
                    {item.danger && i > 0 ? (
                      <hr className="mx-1.5 my-1 h-px border-0 bg-line" />
                    ) : null}
                    {item.href ? (
                      <Link {...common} href={item.href}>
                        {item.label}
                      </Link>
                    ) : (
                      <button {...common} type="button" onClick={item.onSelect}>
                        {item.label}
                      </button>
                    )}
                  </Fragment>
                );
              })}
            </div>
          ) : view === "confirm" ? (
            <div className="flex flex-col gap-2.5 px-2.5 pt-2 pb-1.5 text-[13px] leading-5 text-ink">
              <p className="m-0">
                이 여행을 지우고, 가장 오래 머문 곳 반경{" "}
                <span className="num whitespace-nowrap">{exclusionRadiusText}</span>는 다음 감지부터
                여행으로 보지 않아요.
              </p>
              <span className="flex justify-end gap-2">
                <button
                  ref={cancelRef}
                  type="button"
                  className={cn(
                    SMALL_BTN,
                    "border-transparent bg-transparent text-ink-2 hover:bg-track"
                  )}
                  onClick={backToMenu}
                >
                  취소
                </button>
                <button
                  type="button"
                  data-trip-id={tripId}
                  className={cn(
                    SMALL_BTN,
                    "border-[color-mix(in_oklab,var(--danger)_38%,transparent)] bg-transparent text-danger"
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
                className="h-9 max-sm:h-11 [@media(pointer:coarse)]:h-11 rounded-control border-0 bg-page px-3 text-sm text-ink shadow-[inset_0_0_0_1px_var(--line)] outline-none focus-visible:shadow-[inset_0_0_0_1.5px_var(--brand)]"
              />
              <span className="flex justify-end gap-2">
                <button
                  type="button"
                  className={cn(
                    SMALL_BTN,
                    "border-transparent bg-transparent text-ink-2 hover:bg-track"
                  )}
                  onClick={backToMenu}
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
