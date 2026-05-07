"use client";

import { Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createAccount } from "../hooks";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdded: () => void;
}

const ACCOUNT_TYPES = [
  { value: "general", label: "일반 위탁" },
  { value: "isa_brokerage", label: "ISA 중개형" },
  { value: "pension", label: "개인연금 (연금저축)" },
  { value: "irp", label: "퇴직연금 (IRP)" },
];

export function KISAccountAddDialog({ open, onOpenChange, onAdded }: Props) {
  const [label, setLabel] = useState("");
  const [cano, setCano] = useState("");
  const [acntPrdtCd, setAcntPrdtCd] = useState("01");
  const [accountType, setAccountType] = useState("isa_brokerage");
  const [appKey, setAppKey] = useState("");
  const [appSecret, setAppSecret] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setLabel("");
    setCano("");
    setAcntPrdtCd("01");
    setAccountType("isa_brokerage");
    setAppKey("");
    setAppSecret("");
    setError(null);
    setSubmitting(false);
  };

  const handleSubmit = async () => {
    setError(null);
    if (!label || !cano || !acntPrdtCd || !appKey || !appSecret) {
      setError("모든 필드를 입력해주세요");
      return;
    }
    setSubmitting(true);
    const result = await createAccount({
      label,
      cano,
      acntPrdtCd,
      accountType,
      appKey,
      appSecret,
    });
    setSubmitting(false);

    if (!result.ok) {
      setError(result.error ?? "추가 실패");
      return;
    }

    toast.success("계좌가 추가되었습니다");
    onAdded();
    onOpenChange(false);
    reset();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) reset();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>KIS 계좌 추가</DialogTitle>
          <DialogDescription>
            한국투자증권 OpenAPI 키와 계좌번호를 입력하세요. 검증을 위해 토큰 발급과 잔고 조회가 1회
            실행됩니다.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="label">계좌 라벨</Label>
            <Input
              id="label"
              placeholder="메인 ISA"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-[1fr_auto] gap-2">
            <div className="space-y-1.5">
              <Label htmlFor="cano">계좌번호 (앞 8자리)</Label>
              <Input
                id="cano"
                placeholder="64854415"
                inputMode="numeric"
                maxLength={8}
                value={cano}
                onChange={(e) => setCano(e.target.value.replace(/\D/g, ""))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="prdt">상품코드</Label>
              <Input
                id="prdt"
                placeholder="01"
                inputMode="numeric"
                maxLength={2}
                value={acntPrdtCd}
                onChange={(e) => setAcntPrdtCd(e.target.value.replace(/\D/g, ""))}
                className="w-16"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>계좌 종류</Label>
            <Select value={accountType} onValueChange={setAccountType}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ACCOUNT_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="appKey">App Key</Label>
            <Input
              id="appKey"
              type="text"
              autoComplete="off"
              value={appKey}
              onChange={(e) => setAppKey(e.target.value.trim())}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="appSecret">App Secret</Label>
            <Input
              id="appSecret"
              type="password"
              autoComplete="off"
              value={appSecret}
              onChange={(e) => setAppSecret(e.target.value.trim())}
            />
          </div>

          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting}>
            취소
          </Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                검증 중…
              </>
            ) : (
              "검증 후 추가"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
