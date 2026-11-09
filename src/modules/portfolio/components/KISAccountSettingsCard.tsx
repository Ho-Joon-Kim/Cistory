"use client";

import { Loader2, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { LoadingState } from "@/components/ds";
import { Button } from "@/components/ui/button";
import {
  PanelActions,
  PanelBox,
  PanelIconButton,
  PanelList,
  PanelListItem,
  PanelText,
} from "@/modules/settings/components/panel";
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
      toast.success(`${a.label} 계좌가 동기화되었습니다.`);
      refresh();
    } else {
      toast.error(
        r.error ?? `${a.label} 계좌를 동기화하지 못했습니다. 잠시 후 다시 시도해 주세요.`
      );
    }
  };

  const handleDelete = async (a: AccountListItem) => {
    if (
      !confirm(
        `${a.label} 계좌를 삭제할까요? 저장된 보유 종목·체결 내역·손익 기록이 함께 삭제되며 되돌릴 수 없습니다.`
      )
    ) {
      return;
    }
    setBusyId(a.id);
    const ok = await deleteAccount(a.id);
    setBusyId(null);
    if (ok) {
      toast.success("계좌가 삭제되었습니다.");
      refresh();
    } else {
      toast.error("계좌를 삭제하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <PanelText>
        KIS OpenAPI로 보유 종목·체결 내역·실현손익을 자동으로 가져와요. 계좌 하나에 App Key와 Secret
        한 쌍이 필요해요.
      </PanelText>
      {isLoading ? (
        <LoadingState variant="rows" rows={2} label="계좌를 불러오는 중" />
      ) : accounts.length === 0 ? (
        <PanelText>아직 연결한 계좌가 없어요. 계좌 추가로 시작해 보세요.</PanelText>
      ) : (
        <PanelList label="연결한 계좌">
          {accounts.map((a) => {
            const busy = busyId === a.id;
            return (
              <PanelListItem key={a.id} className="items-center">
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="flex min-w-0 items-baseline gap-2">
                    <span className="truncate text-sm leading-5 font-semibold" title={a.label}>
                      {a.label}
                    </span>
                    <span className="flex-none text-xs text-ink-3">
                      {ACCOUNT_TYPE_LABEL[a.accountType] ?? a.accountType}
                    </span>
                  </span>
                  <span className="text-xs leading-4 text-ink-3">
                    <span className="num">
                      {a.cano}-{a.acntPrdtCd}
                    </span>{" "}
                    · {a.lastSyncedAt ? `${formatRelative(a.lastSyncedAt)} 동기화` : "동기화 전"}
                  </span>
                  {a.lastSyncError ? (
                    <span className="mt-0.5 flex items-start gap-1.5 text-xs leading-4 text-gain">
                      <span
                        aria-hidden="true"
                        className="mt-[5px] size-1.5 flex-none rounded-full bg-gain"
                      />
                      <span className="[overflow-wrap:anywhere]">
                        동기화 실패 · {a.lastSyncError}
                      </span>
                    </span>
                  ) : null}
                </span>
                <span className="-mr-2 flex flex-none items-center">
                  <PanelIconButton
                    label={`${a.label} 계좌 동기화`}
                    onClick={() => void handleSync(a)}
                    disabled={busy}
                  >
                    {busy ? (
                      <Loader2 aria-hidden="true" className="animate-spin" />
                    ) : (
                      <RefreshCw aria-hidden="true" />
                    )}
                  </PanelIconButton>
                  <PanelIconButton
                    label={`${a.label} 계좌 삭제`}
                    onClick={() => void handleDelete(a)}
                    disabled={busy}
                    danger
                  >
                    <Trash2 aria-hidden="true" />
                  </PanelIconButton>
                </span>
              </PanelListItem>
            );
          })}
        </PanelList>
      )}
      <PanelActions>
        <Button
          size="sm"
          variant={accounts.length === 0 && !isLoading ? "default" : "outline"}
          onClick={() => setDialogOpen(true)}
        >
          <Plus aria-hidden="true" />
          계좌 추가
        </Button>
      </PanelActions>
      <PanelBox title="키 발급 가이드">
        <ol className="m-0 flex list-decimal flex-col gap-0.5 pl-4">
          <li>
            <a
              href="https://apiportal.koreainvestment.com"
              target="_blank"
              rel="noreferrer"
              className="text-ink underline underline-offset-[3px]"
            >
              apiportal.koreainvestment.com
            </a>
            에 가입해요.
          </li>
          <li>본인 계좌를 등록하고 App Key와 Secret을 발급받아요.</li>
          <li>계좌마다 키 한 쌍이 필요해요.</li>
        </ol>
      </PanelBox>

      <KISAccountAddDialog open={dialogOpen} onOpenChange={setDialogOpen} onAdded={refresh} />
    </div>
  );
}
