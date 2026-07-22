export function formatWon(value: number): string {
  const safeValue = Number.isFinite(value) ? Math.round(value) : 0;
  return `${safeValue.toLocaleString("ko-KR")}원`;
}
