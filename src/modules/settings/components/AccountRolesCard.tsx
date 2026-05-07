"use client";

import { Loader2, Save, Wallet } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type Role = "default" | "spending" | "ignore";

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
        if (!cancelled) toast.error("계좌 목록을 불러오지 못했습니다");
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
      toast.success(`${roles.length}개 계좌 역할이 저장되었습니다`);
    } catch {
      toast.error("저장에 실패했습니다");
    } finally {
      setIsSaving(false);
    }
  };

  const currentRole = (a: AccountRow): Role => edited.get(a.accountName) ?? a.role;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Wallet className="h-5 w-5" />
          계좌별 분류 역할
        </CardTitle>
        <CardDescription>
          모임통장처럼 입금이 곧 소비인 계좌는 <b>소비 계좌</b>로 표시하세요. 분류는 자동, 예외는
          거래별로 손으로 교정할 수 있습니다.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> 불러오는 중...
          </div>
        ) : accounts.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            아직 분류할 거래가 없습니다. 토스 알림이 수집된 후 다시 확인하세요.
          </p>
        ) : (
          <>
            <div className="space-y-2">
              {accounts.map((a) => {
                const role = currentRole(a);
                const isDirty = edited.has(a.accountName);
                return (
                  <div
                    key={a.accountName}
                    className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between rounded-md border p-3"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm truncate">{a.accountName}</span>
                        <span className="text-xs text-muted-foreground">
                          {a.transactionCount}건
                        </span>
                        {isDirty && <span className="text-xs text-primary">변경됨</span>}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {ROLE_OPTIONS.map((opt) => (
                        <Button
                          key={opt.value}
                          type="button"
                          variant={role === opt.value ? "default" : "outline"}
                          size="sm"
                          onClick={() => setRole(a.accountName, opt.value)}
                          title={opt.help}
                          className="h-7 text-xs"
                        >
                          {opt.label}
                        </Button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="flex items-center justify-between pt-2 border-t">
              <p className="text-xs text-muted-foreground">
                기본=출금이 소비 / 소비 계좌=입금이 소비 / 무시=양방향 집계 제외
              </p>
              <Button onClick={handleSave} disabled={edited.size === 0 || isSaving} size="sm">
                {isSaving ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Save className="h-4 w-4 mr-2" />
                )}
                저장 ({edited.size})
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
