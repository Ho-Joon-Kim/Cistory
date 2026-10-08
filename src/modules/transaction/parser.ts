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
 *   카드 결제는 본문 끝에 잔액 줄이 붙는다: "토스뱅크 체크카드 | 가게\n잔액 7,505원"
 *
 * Pattern 4 – 자동이체 완료:
 *   title "200,000원 자동이체", text "홍금숙님에게 200,000원이 자동이체되었어요."
 *   본인 계좌로의 적금·투자 이체는 메모가 붙는다: "김호준님에게 …되었어요. 주택청약"
 *   토스뱅크 자동이체는 주 통장에서 나가므로 accountName은 "내 토스뱅크 통장"으로 둔다.
 *
 * Pattern 5 – 결제 취소:
 *   title "12,800원 결제 취소", text "토스뱅크 체크카드 | 카카오T택시_가승인 잔액 N원"
 *   type "cancel" 행으로 저장하고, 같은 계좌·가맹점·금액의 원 결제를 소비에서 뺀다
 *   (택시 가승인처럼 실결제와 함께 두 번 잡히던 건). 금액 없는 "결제 취소"는 짝을
 *   특정할 수 없어 파싱하지 않는다.
 */

export interface ParsedTransaction {
  type: "withdrawal" | "deposit" | "cancel";
  amount: number;
  merchant: string;
  accountName: string;
  /**
   * True when the parsed transaction is a transfer to/from the user's own
   * account (matched against ParseOptions.myName). Stored instead of being
   * filtered at parse time so the ingestion endpoint still records the event,
   * and query-layer filters can pick it up by column instead of recomputing
   * `ne(merchant, tossMyName)` on every read.
   */
  isSelfTransfer: boolean;
}

// Pattern 1: "6,900원 출금" / "1원 입금" / "요금납부 31,980원 출금" (공과금 자동납부)
const BASIC_PATTERN = /^(?:요금납부\s+)?([\d,]+)원\s+(출금|입금)$/;

// Pattern 2: "김철수님이 300,000원을 보냈어요"
const TRANSFER_RECEIVED_PATTERN = /^(.+?)님이\s+([\d,]+)원을\s+보냈어요$/;

// Pattern 3: "13,900원 결제"
const PAYMENT_PATTERN = /^([\d,]+)원\s+결제$/;

// Pattern 5: "12,800원 결제 취소"
const PAYMENT_CANCEL_PATTERN = /^([\d,]+)원\s+결제\s+취소$/;

// Pattern 4: "200,000원 자동이체" + "홍금숙님에게 200,000원이 자동이체되었어요. 메모"
const AUTO_TRANSFER_TITLE_PATTERN = /^([\d,]+)원\s+자동이체$/;
const AUTO_TRANSFER_TEXT_PATTERN = /^(.+?)님에게\s+[\d,]+원이\s+자동이체되었어요/;
const AUTO_TRANSFER_ACCOUNT = "내 토스뱅크 통장";

// Card receipts end with the post-payment balance ("가게\n잔액 7,505원"). It is
// account state, not part of the merchant name, and left in place it splits
// one merchant into a new name on every purchase.
const TRAILING_BALANCE_PATTERN = /\s+잔액\s+-?[\d,]+원\s*$/;

export interface ParseOptions {
  myName?: string | null;
}

type Parsed = Omit<ParsedTransaction, "isSelfTransfer">;

const toAmount = (digits: string) => Number(digits.replace(/,/g, ""));

// Pattern 1: 기본 출금/입금
function parseBasic(title: string, text: string): Parsed | null {
  const match = title.match(BASIC_PATTERN);
  if (!match) return null;

  const parts = text.split("→").map((s) => s.trim());
  if (parts.length !== 2) return null;
  const [source, destination] = parts;
  if (!source || !destination) return null;

  return match[2] === "출금"
    ? // 출금: "내 토스뱅크 통장 → 쿠팡" — source=계좌, destination=가맹점
      { type: "withdrawal", amount: toAmount(match[1]), merchant: destination, accountName: source }
    : // 입금: "**** → 내 토스뱅크 통장" — source=송금자, destination=계좌
      { type: "deposit", amount: toAmount(match[1]), merchant: source, accountName: destination };
}

// Pattern 2: 송금 수신 "OOO님이 N원을 보냈어요"
function parseTransferReceived(title: string): Parsed | null {
  const match = title.match(TRANSFER_RECEIVED_PATTERN);
  if (!match) return null;
  return {
    type: "deposit",
    amount: toAmount(match[2]),
    merchant: match[1].trim(),
    accountName: "토스",
  };
}

// Pattern 3/5: 결제 "13,900원 결제" / 결제 취소 "13,900원 결제 취소"
//   + "토스페이머니 | 주식회사 우아한형제들"
function parsePayment(title: string, text: string): Parsed | null {
  const paymentMatch = title.match(PAYMENT_PATTERN);
  const cancelMatch = paymentMatch ? null : title.match(PAYMENT_CANCEL_PATTERN);
  const match = paymentMatch ?? cancelMatch;
  if (!match) return null;

  const parts = text.split("|").map((s) => s.trim());
  if (parts.length !== 2) return null;
  const [accountName, rawMerchant] = parts;
  const merchant = rawMerchant.replace(TRAILING_BALANCE_PATTERN, "").trim();
  if (!accountName || !merchant) return null;

  return {
    type: cancelMatch ? "cancel" : "withdrawal",
    amount: toAmount(match[1]),
    merchant,
    accountName,
  };
}

// Pattern 4: 자동이체 완료 "200,000원 자동이체" + "홍금숙님에게 …자동이체되었어요."
function parseAutoTransfer(title: string, text: string): Parsed | null {
  const titleMatch = title.match(AUTO_TRANSFER_TITLE_PATTERN);
  const textMatch = titleMatch ? text.trim().match(AUTO_TRANSFER_TEXT_PATTERN) : null;
  if (!titleMatch || !textMatch) return null;
  return {
    type: "withdrawal",
    amount: toAmount(titleMatch[1]),
    merchant: textMatch[1].trim(),
    accountName: AUTO_TRANSFER_ACCOUNT,
  };
}

export function parseTossNotification(
  title: string,
  text: string,
  options?: ParseOptions
): ParsedTransaction | null {
  const trimmedTitle = title.trim();
  // Title shapes are mutually exclusive, so at most one parser can match.
  const result =
    parseBasic(trimmedTitle, text) ??
    parseTransferReceived(trimmedTitle) ??
    parsePayment(trimmedTitle, text) ??
    parseAutoTransfer(trimmedTitle, text);
  if (!result) return null;

  // Self-transfer: flag rather than drop. Downstream queries filter by
  // `isSelfTransfer=false` when excluding is wanted; spending/reparse can
  // update the flag retroactively when `tossMyName` changes.
  return {
    ...result,
    isSelfTransfer: Boolean(options?.myName && result.merchant === options.myName),
  };
}
