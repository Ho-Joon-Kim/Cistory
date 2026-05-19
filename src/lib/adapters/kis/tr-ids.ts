export const KIS_TR = {
  INQUIRE_BALANCE_RLZ_PL: "TTTC8494R",
  /** Recent (≤3 months) executions. KIS silently truncates older results. */
  INQUIRE_DAILY_CCLD: "TTTC8001R",
  /**
   * Executions older than 3 months. Same endpoint as INQUIRE_DAILY_CCLD,
   * different tr_id. KIS hard-caps each call to a 1-year window (rt_cd=7,
   * msg_cd=APBK1633 "조회기간은 1년 이내이어야 합니다") — callers must
   * slide windows. Recommended after 15:30 KST to avoid mid-session lag.
   */
  INQUIRE_DAILY_CCLD_OVER_3MO: "CTSC9215R",
  INQUIRE_PERIOD_TRADE_PROFIT: "TTTC8708R",
  INQUIRE_PRICE: "FHKST01010100",
  SEARCH_STOCK_INFO: "CTPF1002R",
} as const;

export const KIS_BASE_URL = "https://openapi.koreainvestment.com:9443";
