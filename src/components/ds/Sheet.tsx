"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { type ReactNode, useRef } from "react";
import { cn } from "@/lib/utils";

/**
 * Bottom sheet (phones): scrim + surface sheet with a 20px top radius and a
 * grab handle. On PC prefer a Popover anchored to the trigger; this sheet
 * centers as a 420px dialog from sm up so it still works there.
 *
 *   <Sheet open={open} onOpenChange={setOpen} title="WakaTime 기간 재수집"
 *          description="고른 날짜의 세션과 일별 합계를 하루씩 다시 가져옵니다.">
 *     …controls…
 *   </Sheet>
 *
 * Focus returns to whatever opened it: the `trigger` when one is passed (Radix
 * does that), otherwise the element that had focus when the sheet opened — a
 * controlled sheet opened from a row button no longer drops focus to <body> on
 * Esc/취소.
 */
export function Sheet({
  open,
  onOpenChange,
  title,
  description,
  children,
  trigger,
  className,
}: {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  trigger?: ReactNode;
  className?: string;
}) {
  const opener = useRef<HTMLElement | null>(null);
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      {trigger ? <DialogPrimitive.Trigger asChild>{trigger}</DialogPrimitive.Trigger> : null}
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-scrim data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          onOpenAutoFocus={() => {
            // Fires before focus moves into the sheet, so this is the opener.
            const active = document.activeElement;
            opener.current =
              active instanceof HTMLElement && active !== document.body ? active : null;
          }}
          onCloseAutoFocus={(event) => {
            const target = opener.current;
            opener.current = null;
            if (trigger || !target?.isConnected) return;
            event.preventDefault();
            target.focus({ preventScroll: true });
          }}
          className={cn(
            "fixed inset-x-0 bottom-0 z-50 flex max-h-[calc(100dvh-48px)] flex-col gap-3.5 overflow-y-auto overscroll-contain rounded-t-sheet bg-surface px-4 pt-2 pb-[max(20px,env(safe-area-inset-bottom))] shadow-[0_-8px_24px_rgb(0_0_0/0.12)] outline-none",
            "data-[state=closed]:animate-out data-[state=closed]:slide-out-to-bottom-2 data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:slide-in-from-bottom-2 data-[state=open]:fade-in-0",
            "sm:inset-x-auto sm:top-1/2 sm:bottom-auto sm:left-1/2 sm:w-[420px] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-sheet sm:pt-5 sm:shadow-pop",
            className
          )}
        >
          <span aria-hidden="true" className="h-1 w-9 self-center rounded-full bg-line sm:hidden" />
          <div className="flex flex-col gap-1">
            <DialogPrimitive.Title className="m-0 text-[17px] leading-6 font-semibold text-ink">
              {title}
            </DialogPrimitive.Title>
            {description ? (
              <DialogPrimitive.Description className="m-0 text-[13px] leading-5 text-ink-2">
                {description}
              </DialogPrimitive.Description>
            ) : null}
          </div>
          {children}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export const SheetClose = DialogPrimitive.Close;
