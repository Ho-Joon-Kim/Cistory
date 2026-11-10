"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { LoadingState, Segmented } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { formatCount } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PanelText } from "./panel";

export type Role = "default" | "spending" | "ignore";

interface AccountRow {
  accountName: string;
  transactionCount: number;
  role: Role;
}

const ROLE_OPTIONS: { value: Role; label: string; help: string }[] = [
  { value: "default", label: "기본", help: "출금=소비, 입금=수입" },
  { value: "spending", label: "소비 계좌", help: "입금=소비, 출금=무시 (모임통장 등)" },
  { value: "ignore", label: "무시", help: "입금/출금 모두 집계에서 제외" },
];

export function AccountRolesCard() {
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [edited, setEdited] = useState<Map<string, Role>>(new Map());
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/settings/account-roles");
        if (!res.ok) throw new Error("failed");
        const data = (await res.json()) as { accounts: AccountRow[] };
        if (!cancelled) setAccounts(data.accounts);
      } catch {
        if (!cancelled) toast.error("계좌 목록을 불러오지 못했어요. 페이지를 새로고침해 주세요.");
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const setRole = (accountName: string, role: Role) => {
    setEdited((prev) => {
      const next = new Map(prev);
      const original = accounts.find((a) => a.accountName === accountName)?.role ?? "default";
      if (role === original) next.delete(accountName);
      else next.set(accountName, role);
      return next;
    });
  };

  const handleSave = async () => {
    if (edited.size === 0) return;
    setIsSaving(true);
    try {
      const roles = Array.from(edited.entries()).map(([accountName, role]) => ({
        accountName,
        role,
      }));
      const res = await fetch("/api/settings/account-roles", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roles }),
      });
      if (!res.ok) throw new Error("failed");
      setAccounts((prev) =>
        prev.map((a) => {
          const newRole = edited.get(a.accountName);
          return newRole ? { ...a, role: newRole } : a;
        })
      );
      setEdited(new Map());
      toast.success(`계좌 ${roles.length}개의 역할이 저장됐어요.`);
    } catch {
      toast.error("계좌 역할을 저장하지 못했어요. 잠시 후 다시 시도해 주세요.");
    } finally {
      setIsSaving(false);
    }
  };

  const currentRole = (a: AccountRow): Role => edited.get(a.accountName) ?? a.role;

  return (
    <div className="flex flex-col gap-4">
      <PanelText>
        모임통장처럼 입금이 곧 소비인 계좌는 <b className="text-ink">소비 계좌</b>로 두세요. 기본은
        출금이 소비, 무시는 입출금 모두 집계에서 빠져요. 거래 한 건만 있는 이름은 알림 문구가 잘못
        읽힌 것일 수 있어요.
      </PanelText>
      {isLoading ? (
        <LoadingState variant="rows" rows={3} label="계좌 목록을 불러오는 중" />
      ) : accounts.length === 0 ? (
        <PanelText>아직 분류할 거래가 없어요. 토스 알림이 들어오면 계좌가 여기에 보여요.</PanelText>
      ) : (
        <>
          <ul className="m-0 list-none border-t border-line p-0">
            {accounts.map((a) => {
              const role = currentRole(a);
              const isDirty = edited.has(a.accountName);
              const suspect = isSuspectAccount(a);
              return (
                <li
                  key={a.accountName}
                  className="flex flex-col gap-2 border-b border-line py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
                >
                  <span className="flex min-w-0 flex-col">
                    <span
                      className="text-sm leading-5 font-semibold [overflow-wrap:anywhere]"
                      title={a.accountName}
                    >
                      {a.accountName}
                    </span>
                    <span
                      className={cn(
                        "text-xs leading-4",
                        suspect ? "text-warn" : isDirty ? "text-brand" : "text-ink-3"
                      )}
                    >
                      거래{" "}
                      <span className="tabular-nums">
                        {formatCount(Number(a.transactionCount))}
                      </span>
                      건{suspect ? " · 이름 확인 필요" : isDirty ? " · 바뀜" : ""}
                    </span>
                  </span>
                  <Segmented
                    items={ROLE_ITEMS}
                    value={role}
                    onChange={(value) => setRole(a.accountName, value)}
                    ariaLabel={`${a.accountName} 분류 역할`}
                    className="sm:w-[220px]"
                  />
                </li>
              );
            })}
          </ul>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs text-ink-3">
              {edited.size > 0
                ? `${edited.size}개 바뀜 — 저장해야 집계에 반영돼요`
                : "바뀐 것 없음"}
            </span>
            <Button onClick={handleSave} disabled={edited.size === 0 || isSaving} size="sm">
              {isSaving ? "저장 중…" : "저장"}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

const ROLE_ITEMS = ROLE_OPTIONS.map((o) => ({
  value: o.value,
  label: o.label,
  ariaLabel: `${o.label} — ${o.help}`,
}));

/**
 * A default-role account name seen on a single transaction: usually parser
 * noise from an unusual notification ("계좌", a merchant name), worth a look.
 */
export function isSuspectAccount(a: { transactionCount: number | string; role: Role }): boolean {
  return a.role === "default" && Number(a.transactionCount) <= 1;
}
