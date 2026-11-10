/**
 * Shared menu-item look for small in-page menus (the trip "…" menu, the account
 * menu). The hover/highlight tint alone (`--track` on the popover surface) is
 * ~1.1:1, so keyboard focus also draws an inset 2px brand outline (≥6:1 on the
 * surface in both themes) — the tint is decoration, the outline is the indicator.
 *
 * Works for plain buttons/links (`:focus-visible`) and Radix menu items, which
 * move real focus between items and expose `data-highlighted`.
 */
export const menuItemFocusClass =
  "outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:-outline-offset-2 focus-visible:outline-brand";

/**
 * 44px minimum row height on phones and touch screens — shared by the in-page
 * menus below and by the Radix account dropdown (UserMenu), so every menu row is
 * a full-size tap target.
 */
export const menuItemTapClass = "max-sm:min-h-11 [@media(pointer:coarse)]:min-h-11";

const MENU_ITEM_BASE = `flex w-full cursor-pointer items-center gap-2.5 rounded-[7px] border-0 bg-transparent px-2.5 py-2 text-left text-[13px] leading-5 transition-colors duration-150 ${menuItemTapClass} hover:bg-track focus-visible:bg-track data-[highlighted]:bg-track ${menuItemFocusClass}`;

export const menuItemClass = `${MENU_ITEM_BASE} text-ink`;

/** A destructive item ("여행 아님으로 표시", "로그아웃"): danger text, same focus outline. */
export const menuItemDangerClass = `${MENU_ITEM_BASE} text-danger`;
