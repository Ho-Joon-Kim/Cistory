"use client";

import { CheckCircle2, Loader2, Plus, RefreshCw, Trash2, XCircle } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { type AccountListItem, deleteAccount, syncAccount, useAccounts } from "../hooks";
import { ACCOUNT_TYPE_LABEL } from "../utils";
import { KISAccountAddDialog } from "./KISAccountAddDialog";

function formatRelative(iso: string | null): string {
  if (!iso) return "동기화 안 됨";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return "방금 전";
  if (ms < 3600_000) return `${Math.floor(ms / 60_000)}분 전`;
  if (ms < 86400_000) return `${Math.floor(ms / 3600_000)}시간 전`;
  return `${Math.floor(ms / 86400_000)}일 전`;
}

export function KISAccountSettingsCard() {
  const { accounts, isLoading, refresh } = useAccounts();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const handleSync = async (a: AccountListItem) => {
    setBusyId(a.id);
    const r = await syncAccount(a.id);
    setBusyId(null);
    if (r.ok) {
      toast.success(`${a.label} 동기화 완료`);
      refresh();
    } else {
      toast.error(r.error ?? "동기화 실패");
    }
  };

  const handleDelete = async (a: AccountListItem) => {
    if (!confirm(`${a.label} 계좌를 삭제하시겠습니까? 보유 종목·체결 내역이 함께 삭제됩니다.`)) {
      return;
    }
    setBusyId(a.id);
    const ok = await deleteAccount(a.id);
    setBusyId(null);
    if (ok) {
      toast.success("계좌가 삭제되었습니다");
      refresh();
    } else {
      toast.error("삭제 실패");
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-2">
        <div>
          <CardTitle>한국투자증권 (KIS)</CardTitle>
          <CardDescription>
            KIS OpenAPI로 보유 종목·체결내역·실현손익을 자동 동기화합니다.
          </CardDescription>
        </div>
        <Button onClick={() => setDialogOpen(true)} size="sm">
          <Plus className="w-4 h-4 mr-1" /> 계좌 추가
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? (
          <div className="text-sm text-muted-foreground">불러오는 중…</div>
        ) : accounts.length === 0 ? (
          <div className="text-sm text-muted-foreground py-6 text-center border-2 border-dashed rounded-lg">
            등록된 계좌가 없습니다. 계좌 추가 버튼을 눌러 시작하세요.
          </div>
        ) : (
          accounts.map((a) => {
            const busy = busyId === a.id;
            return (
              <div key={a.id} className="border rounded-lg p-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      {a.lastSyncError ? (
                        <XCircle className="w-4 h-4 text-red-600 dark:text-red-400 flex-shrink-0" />
                      ) : (
                        <CheckCircle2 className="w-4 h-4 text-green-600 dark:text-green-400 flex-shrink-0" />
                      )}
                      <span className="font-semibold truncate">{a.label}</span>
                      <span className="text-xs text-muted-foreground">
                        {ACCOUNT_TYPE_LABEL[a.accountType] ?? a.accountType}
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground mt-1 space-y-0.5">
                      <div>
                        계좌번호{" "}
                        <span className="font-mono">
                          {a.cano}-{a.acntPrdtCd}
                        </span>
                      </div>
                      <div>
                        상태{" "}
                        <span>
                          마지막 동기화 {formatRelative(a.lastSyncedAt)}
                          {a.lastSyncError && (
                            <span className="text-red-600 dark:text-red-400 ml-2">
                              ({a.lastSyncError})
                            </span>
                          )}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-1 flex-shrink-0">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleSync(a)}
                      disabled={busy}
                    >
                      {busy ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <RefreshCw className="w-3.5 h-3.5" />
                      )}
                      <span className="ml-1.5 hidden sm:inline">동기화</span>
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleDelete(a)}
                      disabled={busy}
                      className="text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/30"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              </div>
            );
          })
        )}

        <div className="text-xs text-muted-foreground pt-2 border-t mt-4">
          <p className="font-medium mb-1">키 발급 가이드</p>
          <ol className="list-decimal list-inside space-y-0.5">
            <li>
              <a
                href="https://apiportal.koreainvestment.com"
                target="_blank"
                rel="noreferrer"
                className="underline"
              >
                apiportal.koreainvestment.com
              </a>{" "}
              가입
            </li>
            <li>본인 계좌 등록 후 App Key / Secret 발급</li>
            <li>계좌 1개당 1쌍의 키가 필요합니다</li>
          </ol>
        </div>
      </CardContent>

      <KISAccountAddDialog open={dialogOpen} onOpenChange={setDialogOpen} onAdded={refresh} />
    </Card>
  );
}
