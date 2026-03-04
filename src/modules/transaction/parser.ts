/**
 * Toss notification parser
 *
 * Parses structured transaction data from Toss app notification title/text.
 *
 * Pattern 1 – 기본 출금/입금:
 *   title "6,900원 출금", text "내 토스뱅크 통장 → 쿠팡"
 *   title "1원 입금",     text "**** → 내 토스뱅크 통장"
 *
 * Pattern 2 – 송금 알림:
 *   title "김철수님이 300,000원을 보냈어요"
 *   (text는 무시 — 계좌/가맹점 정보 없음)
 *
 * Pattern 3 – 결제:
 *   title "13,900원 결제", text "토스페이머니 | 주식회사 우아한형제들"
 */

export interface ParsedTransaction {
  type: "withdrawal" | "deposit";
  amount: number;
  merchant: string;
  accountName: string;
}

// Pattern 1: "6,900원 출금" / "1원 입금"
const BASIC_PATTERN = /^([\d,]+)원\s+(출금|입금)$/;

// Pattern 2: "김철수님이 300,000원을 보냈어요"
const TRANSFER_RECEIVED_PATTERN = /^(.+?)님이\s+([\d,]+)원을\s+보냈어요$/;

// Pattern 3: "13,900원 결제"
const PAYMENT_PATTERN = /^([\d,]+)원\s+결제$/;

export function parseTossNotification(title: string, text: string): ParsedTransaction | null {
  const trimmedTitle = title.trim();

  // Pattern 1: 기본 출금/입금
  const basicMatch = trimmedTitle.match(BASIC_PATTERN);
  if (basicMatch) {
    const amount = Number(basicMatch[1].replace(/,/g, ""));
    const typeKor = basicMatch[2];
    const type = typeKor === "출금" ? "withdrawal" : "deposit";

    const parts = text.split("→").map((s) => s.trim());
    if (parts.length !== 2) return null;

    const [source, destination] = parts;
    if (!source || !destination) return null;

    if (type === "withdrawal") {
      // 출금: "내 토스뱅크 통장 → 쿠팡" — source=계좌, destination=가맹점
      return { type, amount, merchant: destination, accountName: source };
    }

    // 입금: "**** → 내 토스뱅크 통장" — source=송금자, destination=계좌
    return { type, amount, merchant: source, accountName: destination };
  }

  // Pattern 2: 송금 수신 "OOO님이 N원을 보냈어요"
  const transferMatch = trimmedTitle.match(TRANSFER_RECEIVED_PATTERN);
  if (transferMatch) {
    const sender = transferMatch[1].trim();
    const amount = Number(transferMatch[2].replace(/,/g, ""));
    return { type: "deposit", amount, merchant: sender, accountName: "토스" };
  }

  // Pattern 3: 결제 "13,900원 결제" + "토스페이머니 | 주식회사 우아한형제들"
  const paymentMatch = trimmedTitle.match(PAYMENT_PATTERN);
  if (paymentMatch) {
    const amount = Number(paymentMatch[1].replace(/,/g, ""));
    const parts = text.split("|").map((s) => s.trim());
    if (parts.length !== 2) return null;

    const [accountName, merchant] = parts;
    if (!accountName || !merchant) return null;

    return { type: "withdrawal", amount, merchant, accountName };
  }

  return null;
}
