export interface KISTokenResponse {
  access_token: string;
  access_token_token_expired: string;
  token_type: string;
  expires_in: number;
}

export interface KISBalancePosition {
  pdno: string;
  prdt_name: string;
  hldg_qty: string;
  ord_psbl_qty: string;
  pchs_avg_pric: string;
  pchs_amt: string;
  prpr: string;
  evlu_amt: string;
  evlu_pfls_amt: string;
  evlu_pfls_rt: string;
  fltt_rt?: string;
  trad_dvsn_name?: string;
}

export interface KISBalanceSummary {
  dnca_tot_amt: string;
  scts_evlu_amt: string;
  tot_evlu_amt: string;
  pchs_amt_smtl_amt: string;
  evlu_amt_smtl_amt: string;
  evlu_pfls_smtl_amt: string;
  bfdy_tot_asst_evlu_amt?: string;
  asst_icdc_amt?: string;
  asst_icdc_erng_rt?: string;
  rlzt_pfls?: string;
  real_evlu_pfls?: string;
  real_evlu_pfls_erng_rt?: string;
  nass_amt?: string;
}

export interface KISBalanceResponse {
  rt_cd: string;
  msg_cd: string;
  msg1: string;
  output1?: KISBalancePosition[];
  output2?: KISBalanceSummary[];
  ctx_area_fk100?: string;
  ctx_area_nk100?: string;
}

export interface KISExecutionRow {
  ord_dt: string;
  odno: string;
  ord_tmd?: string;
  pdno: string;
  prdt_name: string;
  sll_buy_dvsn_cd: string;
  sll_buy_dvsn_cd_name?: string;
  ord_qty: string;
  ord_unpr: string;
  tot_ccld_qty: string;
  tot_ccld_amt: string;
  avg_prvs?: string;
  cncl_yn?: string;
  rmn_qty?: string;
  rjct_qty?: string;
}

export interface KISCcldResponse {
  rt_cd: string;
  msg_cd: string;
  msg1: string;
  output1?: KISExecutionRow[];
  output2?: Record<string, string>;
  ctx_area_fk100?: string;
  ctx_area_nk100?: string;
}

export interface KISDailyPnlRow {
  trad_dt: string;
  buy_amt: string;
  sll_amt: string;
  rlzt_pfls: string;
  fee: string;
  loan_int?: string;
  tl_tax: string;
  pfls_rt?: string;
}

export interface KISPeriodPnlResponse {
  rt_cd: string;
  msg_cd: string;
  msg1: string;
  output1?: KISDailyPnlRow[];
  output2?: Record<string, string>;
  ctx_area_fk100?: string;
  ctx_area_nk100?: string;
}

export interface KISPriceOutput {
  stck_prpr: string;
  prdy_vrss: string;
  prdy_ctrt: string;
  acml_vol: string;
  w52_hgpr?: string;
  w52_lwpr?: string;
}

export interface KISPriceResponse {
  rt_cd: string;
  msg1: string;
  output?: KISPriceOutput;
}

export interface KISStockInfoResponse {
  rt_cd: string;
  msg1: string;
  output?: {
    pdno: string;
    prdt_name: string;
    prdt_eng_name?: string;
    prdt_type_cd: string;
    mket_id_cd?: string;
    excg_dvsn_cd?: string;
    etf_dvsn_cd?: string;
    std_idst_clsf_cd_name?: string;
    idx_bztp_lcls_cd_name?: string;
    idx_bztp_mcls_cd_name?: string;
    idx_bztp_scls_cd_name?: string;
  };
}

export interface ParsedExecution {
  odno: string;
  ordDt: string;
  ordTime: string | null;
  side: "buy" | "sell";
  ticker: string;
  name: string;
  orderQty: number;
  filledQty: number;
  filledAmount: number;
  avgPrice: number;
  cancelled: boolean;
  raw: KISExecutionRow;
}

export interface ParsedDailyPnl {
  tradeDate: string;
  buyAmount: number;
  sellAmount: number;
  realizedPnl: number;
  fee: number;
  tax: number;
}

export interface ParsedBalance {
  positions: Array<{
    ticker: string;
    name: string;
    quantity: number;
    avgPrice: number;
    currentPrice: number;
    evalAmount: number;
    pnl: number;
    pnlRate: number | null;
    weight: number;
    raw: KISBalancePosition;
  }>;
  summary: {
    totalEvalAmount: number;
    securitiesEvalAmount: number;
    deposit: number;
    totalPurchaseAmount: number;
    totalPnl: number;
    totalPnlRate: number | null;
    realizedPnl: number | null;
    prevDayTotalAsset: number | null;
    assetIcdcAmt: number | null;
    raw: KISBalanceSummary;
  };
}

export class KISAuthError extends Error {
  constructor(
    message: string,
    public code: string
  ) {
    super(message);
    this.name = "KISAuthError";
  }
}

export class KISApiError extends Error {
  constructor(
    message: string,
    public code: string,
    public status?: number
  ) {
    super(message);
    this.name = "KISApiError";
  }
}
