/**
 * Toss notification parser
 *
 * Parses structured transaction data from Toss app notification title/text.
 *
 * 출금: title "6,900원 출금", text "내 토스뱅크 통장 → 쿠팡"
 * 입금: title "1원 입금", text "**** → 내 토스뱅크 통장"
 */

export interface ParsedTransaction {
  type: "withdrawal" | "deposit";
  amount: number;
  merchant: string;
  accountName: string;
}

const TITLE_PATTERN = /^([\d,]+)원\s+(출금|입금)$/;

export function parseTossNotification(title: string, text: string): ParsedTransaction | null {
  const titleMatch = title.trim().match(TITLE_PATTERN);
  if (!titleMatch) return null;

  const amount = Number(titleMatch[1].replace(/,/g, ""));
  const typeKor = titleMatch[2];
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
