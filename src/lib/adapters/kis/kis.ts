import { logger } from "@/lib/logger";
import { KIS_BASE_URL, KIS_TR } from "./tr-ids";
import {
  KISApiError,
  KISAuthError,
  type KISBalanceResponse,
  type KISCcldResponse,
  type KISPeriodPnlResponse,
  type KISPriceResponse,
  type KISStockInfoResponse,
  type KISTokenResponse,
  type ParsedBalance,
  type ParsedDailyPnl,
  type ParsedExecution,
} from "./types";

const REQUEST_TIMEOUT_MS = 15_000;
const MAX_RETRIES = 3;
const THROTTLE_MS = 250;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function backoff(attempt: number): Promise<void> {
  return sleep(500 * 2 ** (attempt - 1));
}

function toNumber(value: string | undefined | null): number {
  if (!value) return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function toNumberOrNull(value: string | undefined | null): number | null {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

interface KISRequestOptions {
  trId: string;
  path: string;
  query: Record<string, string>;
  token: string;
}

export class KISAdapter {
  private lastCallAt = 0;

  constructor(
    private readonly appKey: string,
    private readonly appSecret: string
  ) {}

  async issueToken(): Promise<{ accessToken: string; expiresAt: Date }> {
    const response = await fetch(`${KIS_BASE_URL}/oauth2/tokenP`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        grant_type: "client_credentials",
        appkey: this.appKey,
        appsecret: this.appSecret,
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      logger.error("[KIS] Token issue failed", {
        status: response.status,
        body: text.slice(0, 200),
      });
      throw new KISAuthError(`Token issue failed: ${response.status}`, "TOKEN_HTTP_ERROR");
    }

    const data = (await response.json()) as KISTokenResponse & {
      error_code?: string;
      error_description?: string;
    };

    if (!data.access_token) {
      throw new KISAuthError(
        data.error_description || "Token response missing access_token",
        data.error_code || "TOKEN_MISSING"
      );
    }

    const expiresAt = new Date(Date.now() + data.expires_in * 1000);
    return { accessToken: data.access_token, expiresAt };
  }

  private async throttle(): Promise<void> {
    const now = Date.now();
    const elapsed = now - this.lastCallAt;
    if (elapsed < THROTTLE_MS) {
      await sleep(THROTTLE_MS - elapsed);
    }
    this.lastCallAt = Date.now();
  }

  private async fetchKIS<T extends { rt_cd: string; msg_cd?: string; msg1?: string }>(
    options: KISRequestOptions
  ): Promise<T> {
    const { trId, path, query, token } = options;
    const url = new URL(`${KIS_BASE_URL}${path}`);
    for (const [k, v] of Object.entries(query)) {
      url.searchParams.append(k, v);
    }

    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      await this.throttle();

      try {
        const response = await fetch(url.toString(), {
          method: "GET",
          headers: {
            authorization: `Bearer ${token}`,
            appkey: this.appKey,
            appsecret: this.appSecret,
            tr_id: trId,
            custtype: "P",
          },
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });

        if (response.status >= 500) {
          lastError = new Error(`KIS ${trId} HTTP ${response.status}`);
          if (attempt < MAX_RETRIES) {
            await backoff(attempt);
            continue;
          }
          throw lastError;
        }

        const body = (await response.json()) as T;

        // Throttle error → retry with backoff
        if (body.msg_cd === "EGW00201" && attempt < MAX_RETRIES) {
          await backoff(attempt);
          continue;
        }

        // Authorization-shape errors → throw immediately
        if (body.rt_cd !== "0") {
          const code = body.msg_cd ?? "UNKNOWN";
          const message = (body.msg1 ?? "").trim() || `KIS error ${code}`;

          if (
            code === "OPSQ2000" ||
            code === "APBK1271" ||
            code === "APAC0489" ||
            code === "EGW02007"
          ) {
            throw new KISAuthError(message, code);
          }

          throw new KISApiError(message, code, response.status);
        }

        return body;
      } catch (err) {
        if (err instanceof KISAuthError || err instanceof KISApiError) {
          throw err;
        }
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt < MAX_RETRIES) {
          await backoff(attempt);
          continue;
        }
        throw lastError;
      }
    }

    throw lastError ?? new Error(`KIS ${trId} failed`);
  }

  async inquireBalance(
    token: string,
    cano: string,
    acntPrdtCd: string
  ): Promise<ParsedBalance> {
    const positions: ParsedBalance["positions"] = [];
    let summary: ParsedBalance["summary"] | null = null;
    let fk = "";
    let nk = "";

    do {
      const data: KISBalanceResponse = await this.fetchKIS<KISBalanceResponse>({
        trId: KIS_TR.INQUIRE_BALANCE_RLZ_PL,
        path: "/uapi/domestic-stock/v1/trading/inquire-balance-rlz-pl",
        query: {
          CANO: cano,
          ACNT_PRDT_CD: acntPrdtCd,
          AFHR_FLPR_YN: "N",
          OFL_YN: "",
          INQR_DVSN: "00",
          UNPR_DVSN: "01",
          FUND_STTL_ICLD_YN: "N",
          FNCG_AMT_AUTO_RDPT_YN: "N",
          PRCS_DVSN: "00",
          COST_ICLD_YN: "N",
          CTX_AREA_FK100: fk,
          CTX_AREA_NK100: nk,
        },
        token,
      });

      const o2 = data.output2?.[0];
      if (o2 && !summary) {
        const securities = toNumber(o2.scts_evlu_amt);
        summary = {
          totalEvalAmount: toNumber(o2.tot_evlu_amt),
          securitiesEvalAmount: securities,
          deposit: toNumber(o2.dnca_tot_amt),
          totalPurchaseAmount: toNumber(o2.pchs_amt_smtl_amt),
          totalPnl: toNumber(o2.evlu_pfls_smtl_amt),
          totalPnlRate:
            toNumberOrNull(o2.real_evlu_pfls_erng_rt) ??
            toNumberOrNull(o2.asst_icdc_erng_rt),
          realizedPnl: toNumberOrNull(o2.real_evlu_pfls) ?? toNumberOrNull(o2.rlzt_pfls),
          prevDayTotalAsset: toNumberOrNull(o2.bfdy_tot_asst_evlu_amt),
          assetIcdcAmt: toNumberOrNull(o2.asst_icdc_amt),
          raw: o2,
        };
      }

      const denom = summary?.securitiesEvalAmount || 0;
      for (const row of data.output1 ?? []) {
        const evalAmount = toNumber(row.evlu_amt);
        positions.push({
          ticker: row.pdno,
          name: row.prdt_name,
          quantity: toNumber(row.hldg_qty),
          avgPrice: toNumber(row.pchs_avg_pric),
          currentPrice: toNumber(row.prpr),
          evalAmount,
          pnl: toNumber(row.evlu_pfls_amt),
          pnlRate: toNumberOrNull(row.evlu_pfls_rt),
          weight: denom > 0 ? evalAmount / denom : 0,
          raw: row,
        });
      }

      fk = (data.ctx_area_fk100 ?? "").trim();
      nk = (data.ctx_area_nk100 ?? "").trim();
    } while (nk !== "");

    if (!summary) {
      throw new KISApiError("Balance response missing summary", "NO_SUMMARY");
    }

    return { positions, summary };
  }

  async inquireDailyCcld(
    token: string,
    cano: string,
    acntPrdtCd: string,
    startDt: string,
    endDt: string
  ): Promise<ParsedExecution[]> {
    const out: ParsedExecution[] = [];
    let fk = "";
    let nk = "";

    do {
      const data: KISCcldResponse = await this.fetchKIS<KISCcldResponse>({
        trId: KIS_TR.INQUIRE_DAILY_CCLD,
        path: "/uapi/domestic-stock/v1/trading/inquire-daily-ccld",
        query: {
          CANO: cano,
          ACNT_PRDT_CD: acntPrdtCd,
          INQR_STRT_DT: startDt,
          INQR_END_DT: endDt,
          SLL_BUY_DVSN_CD: "00",
          INQR_DVSN: "00",
          PDNO: "",
          CCLD_DVSN: "00",
          ORD_GNO_BRNO: "",
          ODNO: "",
          INQR_DVSN_3: "00",
          INQR_DVSN_1: "",
          CTX_AREA_FK100: fk,
          CTX_AREA_NK100: nk,
        },
        token,
      });

      for (const row of data.output1 ?? []) {
        const filledQty = toNumber(row.tot_ccld_qty);
        const isBuy = row.sll_buy_dvsn_cd === "02";
        out.push({
          odno: row.odno,
          ordDt: row.ord_dt,
          ordTime: row.ord_tmd ?? null,
          side: isBuy ? "buy" : "sell",
          ticker: row.pdno,
          name: row.prdt_name,
          orderQty: toNumber(row.ord_qty),
          filledQty,
          filledAmount: toNumber(row.tot_ccld_amt),
          avgPrice: toNumber(row.avg_prvs ?? row.ord_unpr),
          cancelled: row.cncl_yn === "Y",
          raw: row,
        });
      }

      fk = (data.ctx_area_fk100 ?? "").trim();
      nk = (data.ctx_area_nk100 ?? "").trim();
    } while (nk !== "");

    return out;
  }

  async inquirePeriodProfit(
    token: string,
    cano: string,
    acntPrdtCd: string,
    startDt: string,
    endDt: string
  ): Promise<ParsedDailyPnl[]> {
    const out: ParsedDailyPnl[] = [];
    let fk = "";
    let nk = "";

    do {
      const data: KISPeriodPnlResponse = await this.fetchKIS<KISPeriodPnlResponse>({
        trId: KIS_TR.INQUIRE_PERIOD_TRADE_PROFIT,
        path: "/uapi/domestic-stock/v1/trading/inquire-period-trade-profit",
        query: {
          CANO: cano,
          ACNT_PRDT_CD: acntPrdtCd,
          SORT_DVSN: "00",
          PDNO: "",
          INQR_STRT_DT: startDt,
          INQR_END_DT: endDt,
          CBLC_DVSN: "00",
          CTX_AREA_FK100: fk,
          CTX_AREA_NK100: nk,
        },
        token,
      });

      for (const row of data.output1 ?? []) {
        out.push({
          tradeDate: row.trad_dt,
          buyAmount: toNumber(row.buy_amt),
          sellAmount: toNumber(row.sll_amt),
          realizedPnl: toNumber(row.rlzt_pfls),
          fee: toNumber(row.fee),
          tax: toNumber(row.tl_tax),
        });
      }

      fk = (data.ctx_area_fk100 ?? "").trim();
      nk = (data.ctx_area_nk100 ?? "").trim();
    } while (nk !== "");

    return out;
  }

  async inquirePrice(token: string, ticker: string) {
    const data: KISPriceResponse = await this.fetchKIS<KISPriceResponse>({
      trId: KIS_TR.INQUIRE_PRICE,
      path: "/uapi/domestic-stock/v1/quotations/inquire-price",
      query: {
        FID_COND_MRKT_DIV_CODE: "J",
        FID_INPUT_ISCD: ticker,
      },
      token,
    });
    return data.output ?? null;
  }

  async searchStockInfo(token: string, ticker: string, productTypeCd = "300") {
    const data: KISStockInfoResponse = await this.fetchKIS<KISStockInfoResponse>({
      trId: KIS_TR.SEARCH_STOCK_INFO,
      path: "/uapi/domestic-stock/v1/quotations/search-stock-info",
      query: {
        PDNO: ticker,
        PRDT_TYPE_CD: productTypeCd,
      },
      token,
    });
    return data.output ?? null;
  }
}

export function createKISAdapter(appKey: string, appSecret: string): KISAdapter {
  return new KISAdapter(appKey, appSecret);
}
