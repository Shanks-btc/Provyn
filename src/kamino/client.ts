/**
 * Kamino Lend integration.
 *
 * This wraps @kamino-finance/klend-sdk rather than reimplementing lending logic —
 * Kamino already runs the live xStocks collateral market on Solana mainnet
 * (60+ tokenized equities, isolated risk pools). We are a client of that market,
 * not a lending protocol ourselves.
 *
 * NOTE: klend-sdk v7.x is built on @solana/kit (Solana's newer RPC/address stack),
 * NOT classic @solana/web3.js Connection/PublicKey — the SDK's own README examples
 * are stale on this point. This file is written and typechecked against the real
 * installed v7.3.20 API, not the README.
 *
 * UNVERIFIED / NEEDS A LIVE CHECK (do this before building anything on top):
 *   1. Confirm KAMINO_MAIN_MARKET in .env is the market xStocks actually live in —
 *      Kamino runs multiple isolated markets. Check via `npm run check:market`.
 *   2. Confirm the exact reserve `symbol` strings for the xStocks you plan to
 *      support (e.g. "AAPLx" vs "AAPL.x") — getReserveBySymbol needs an exact match.
 *   3. Confirm loanToValuePct / liquidationThresholdPct per xStock reserve — these
 *      vary by asset and directly drive the agent's risk logic below.
 */

import {
  createSolanaRpc,
  address,
  none,
  type Address,
  type Instruction,
  type Account,
  type TransactionSigner,
} from "@solana/kit";
import {
  KaminoMarket,
  KaminoAction,
  VanillaObligation,
  MultiplyObligation,
  ObligationTypeTag,
  getDepositWithLeverageIxs,
  getScopeRefreshIxForObligationAndReserves,
  DEFAULT_RECENT_SLOT_DURATION_MS,
  PROGRAM_ID,
  U64_MAX,
  type KaminoObligation,
  type Position,
} from "@kamino-finance/klend-sdk";
import { fetchAllAddressLookupTable, type AddressLookupTable } from "@solana-program/address-lookup-table";
import Decimal from "decimal.js";
import { createJupiterQuoter, createJupiterSwapper, type JupiterQuoteResponse } from "./jupiter";

const KAMINO_API_BASE = "https://api.kamino.finance";
// Kamino's leverage/metrics endpoint took ~8.3s to respond on 2026-09-24, so the original 10s
// bound tripped on normal calls. 25s still stops a genuinely hung request.
const KAMINO_API_TIMEOUT_MS = 25_000;
const LEVERAGE_METRICS_TTL_MS = 60_000;

/** One row of Kamino's GET /kamino-market/{market}/leverage/metrics response. */
interface RawLeverageMetric {
  depositReserve: string;
  borrowReserve: string;
  tag: string;
  tvl: string;
  avgLeverage: string;
  totalBorrowed: string;
  totalDeposited: string;
  totalBorrowedUsd: string;
  totalDepositedUsd: string;
  totalObligations: string;
  updatedOn: string;
}

export interface ReserveSnapshot {
  symbol: string;
  mintAddress: string;
  loanToValuePct: number;
  liquidationThresholdPct: number;
  totalSupply: string;
  totalBorrowed: string;
}

/** One reserve inside an obligation — what is actually deposited or borrowed, by symbol. */
export interface PositionLeg {
  symbol: string;
  reserveAddress: string;
  mintAddress: string;
  amount: string; // human-readable token amount (not lamports)
  valueUsd: string;
}

export interface ObligationDetail {
  obligationAddress: string;
  type: string; // "Vanilla" | "Multiply" | "Lending" | "Leverage" — from the obligation's on-chain tag
  deposits: PositionLeg[];
  borrows: PositionLeg[];
  totalDepositUsd: string;
  totalBorrowUsd: string;
  borrowLimitUsd: string;
  liquidationLimitUsd: string;
  netAccountValueUsd: string;
  ltv: string;
  liquidationLtv: string;
  /** liquidationLimitUsd / borrow-factor-adjusted debt. Liquidation at 1.0; null when there is no debt. */
  healthFactor: string | null;
}

/** Spot (not deposited) balance the wallet holds of a token this market lists. */
export interface WalletBalance {
  symbol: string;
  mintAddress: string;
  /** raw base units / 10^decimals — what Kamino can actually move; the most that can be deposited. */
  amount: string;
  /** Wallet-UI amount. Differs for xStocks: their Token-2022 scaledUiAmount multiplier inflates it. */
  displayAmount: string;
  valueUsd: string; // amount × Kamino's oracle price
}

export interface WalletPosition {
  walletAddress: string;
  /** Every obligation the wallet owns in this market, each broken down per reserve. */
  obligations: ObligationDetail[];
  /** Flattened, de-duplicated symbols — the only valid source for "you already have X deposited". */
  depositedSymbols: string[];
  borrowedSymbols: string[];
  walletBalances: WalletBalance[];
  solBalance: string;
}

export interface AssetCapabilities {
  symbol: string;
  listed: boolean;
  /** "live", or "cache" when Kamino's API failed and the last good result was reused (see fallback). */
  dataSource: "live" | "cache";
  fallback?: { cachedAt: string; liveError: string };
  oraclePriceUsd?: string;
  loanToValuePct?: number;
  liquidationThresholdPct?: number;
  borrow: { supported: boolean; reason: string; debtSymbol?: string; debtBorrowApyPct?: string };
  earn: { supported: boolean; reason: string; supplySymbol?: string; supplyApyPct?: string };
  multiply: {
    supported: boolean;
    reason: string;
    debtSymbol?: string;
    liveObligations?: string;
    avgLeverage?: string;
    tvlUsd?: string;
  };
}

const OBLIGATION_TYPE_NAMES: Record<number, string> = {
  [ObligationTypeTag.Vanilla]: "Vanilla",
  [ObligationTypeTag.Multiply]: "Multiply",
  [ObligationTypeTag.Lending]: "Lending",
  [ObligationTypeTag.Leverage]: "Leverage",
};

const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";

/**
 * One row from Kamino's live `GET /kamino-market/{market}/leverage/metrics` endpoint,
 * filtered to a single symbol's Multiply-tagged entries and with reserve addresses
 * resolved back to symbols via the already-loaded market (the raw API only returns
 * reserve pubkeys, not symbols).
 */
export interface MultiplyMetric {
  depositSymbol: string;
  depositReserve: string;
  borrowSymbol: string;
  borrowReserve: string;
  tag: string; // "Multiply" | "Leverage" — only "Multiply" rows are returned here
  tvl: string;
  avgLeverage: string;
  totalBorrowed: string;
  totalDeposited: string;
  totalBorrowedUsd: string;
  totalDepositedUsd: string;
  totalObligations: string;
  updatedOn: string;
}

export interface MultiplyObligationSnapshot {
  walletAddress: string;
  symbol: string;
  hasObligation: boolean;
  collateralAmount?: string;
  debtAmount?: string;
  netAccountValueUsd?: string;
  ltv?: string;
}

export class KaminoClient {
  private rpc: ReturnType<typeof createSolanaRpc>;
  private marketAddress: Address;
  private market: KaminoMarket | null = null;

  constructor(rpcUrl: string, marketAddress: string) {
    this.rpc = createSolanaRpc(rpcUrl);
    this.marketAddress = address(marketAddress);
  }

  /** Exposes the underlying read-only RPC connection for callers building/simulating transactions. */
  getRpc(): ReturnType<typeof createSolanaRpc> {
    return this.rpc;
  }

  /** Must be called before any other method. Loads market metadata + all reserves. */
  async init(): Promise<void> {
    this.market = await KaminoMarket.load(
      this.rpc,
      this.marketAddress,
      DEFAULT_RECENT_SLOT_DURATION_MS,
      PROGRAM_ID,
      /* withReserves */ true
    );
    if (!this.market) {
      throw new Error(
        `Kamino market not found at ${this.marketAddress} — ` +
          `verify KAMINO_MAIN_MARKET is current before proceeding.`
      );
    }
  }

  private requireMarket(): KaminoMarket {
    if (!this.market) {
      throw new Error("KaminoClient.init() must be called before use.");
    }
    return this.market;
  }

  /**
   * Lists every reserve in the market with its risk parameters.
   * Use this first, always — don't hardcode a list of "known xStock symbols"
   * until you've confirmed against live data what's actually listed.
   */
  listReserves(): ReserveSnapshot[] {
    const market = this.requireMarket();
    return market.getReserves().map((reserve) => ({
      symbol: reserve.symbol,
      mintAddress: reserve.getLiquidityMint(),
      loanToValuePct: reserve.stats.loanToValue,
      liquidationThresholdPct: reserve.stats.liquidationThreshold,
      totalSupply: reserve.getTotalSupply().toString(),
      totalBorrowed: reserve.getBorrowedAmount().toString(),
    }));
  }

  /**
   * Kamino's oracle price for a reserve plus the mint's EFFECTIVE Token-2022 scaled-UI multiplier, for comparing the
   * on-chain price with a real stock quote.
   *
   * MEASURED 2026-10-06 (see TESTPLAN.md): Kamino's oracle price per xStock token is NOT the stock price. It is the stock
   * price times the mint's effective multiplier (AAPLx 1.003269, SPYx 1.005715, TSLAx 1), so dividing by it is required
   * before any comparison. Effective = `newMultiplier` once its `newMultiplierEffectiveTimestamp` has passed, else
   * `multiplier`. Returns multiplier null (never a guessed 1) if the mint can't be read, so callers must say so.
   */
  async getOracleReference(symbol: string): Promise<{
    symbol: string;
    mintAddress: string;
    oraclePriceUsd: number;
    uiMultiplier: number | null;
    uiMultiplierSource: string;
  }> {
    const reserve = this.getReserve(symbol);
    const mintAddress = String(reserve.getLiquidityMint());
    const oraclePriceUsd = Number(reserve.getOracleMarketPrice().toString());
    try {
      const acc = await this.rpc.getAccountInfo(address(mintAddress), { encoding: "jsonParsed" }).send();
      const info: any = (acc.value?.data as any)?.parsed?.info;
      const ext = info?.extensions?.find((e: any) => e.extension === "scaledUiAmountConfig")?.state;
      if (!ext) return { symbol, mintAddress, oraclePriceUsd, uiMultiplier: 1, uiMultiplierSource: "mint has no scaledUiAmountConfig extension" };
      const now = Math.floor(Date.now() / 1000);
      const useNew = Number(ext.newMultiplierEffectiveTimestamp) > 0 && now >= Number(ext.newMultiplierEffectiveTimestamp);
      const m = Number(useNew ? ext.newMultiplier : ext.multiplier);
      if (!(m > 0)) throw new Error("multiplier is not a positive number");
      return { symbol, mintAddress, oraclePriceUsd, uiMultiplier: m, uiMultiplierSource: useNew ? "scaledUiAmountConfig.newMultiplier (effective)" : "scaledUiAmountConfig.multiplier" };
    } catch (err) {
      return { symbol, mintAddress, oraclePriceUsd, uiMultiplier: null, uiMultiplierSource: `could not read the mint: ${(err as Error).message}` };
    }
  }

  /** Filters listReserves() down to symbols that look like xStocks (heuristic — verify). */
  listXStockReserves(): ReserveSnapshot[] {
    return this.listReserves().filter((r) => /x$/i.test(r.symbol) || /^x/i.test(r.symbol));
  }

  getReserve(symbol: string) {
    const market = this.requireMarket();
    const reserve = market.getReserveBySymbol(symbol);
    if (!reserve) {
      throw new Error(
        `No reserve found for symbol "${symbol}". Call listReserves() to see ` +
          `what's actually available — don't assume the ticker format.`
      );
    }
    return reserve;
  }

  /**
   * Reads everything the wallet has in this market: every obligation it owns (any type —
   * Vanilla, Multiply, …), broken down per reserve, plus its spot balances of listed tokens.
   *
   * WHY PER-RESERVE (Phase 5): the old getObligation() returned only aggregates
   * (borrowLimitUsd/currentBorrowUsd/netAccountValueUsd/ltv) for the Vanilla obligation. With
   * no data saying *which* asset was deposited, the agent inferred it from the user's wording
   * and told a wallet whose collateral is really MSTRx that it "already has AAPLx deposited"
   * (caught by the Phase 3 RefreshObligation log). Every deposit/borrow here is resolved from
   * the obligation's own on-chain reserve addresses, never from user input.
   */
  async getPosition(walletAddress: string): Promise<WalletPosition> {
    const market = this.requireMarket();
    const owner = address(walletAddress);

    // These three reads are independent — VERIFIED 2026-10-02: running them sequentially (obligations, then
    // balances+SOL) measured 12-15s end to end against the public RPC on some requests; Promise.all-ing all three
    // instead of only the last two cuts it to roughly the slowest single call.
    const [obligations, walletBalances, solBalance] = await Promise.all([
      market.getAllUserObligations(owner),
      this.getWalletBalances(walletAddress),
      this.rpc.getBalance(owner).send(),
    ]);
    const details = obligations.map((o) => this.describeObligation(o));

    return {
      walletAddress,
      obligations: details,
      depositedSymbols: [...new Set(details.flatMap((d) => d.deposits.map((l) => l.symbol)))],
      borrowedSymbols: [...new Set(details.flatMap((d) => d.borrows.map((l) => l.symbol)))],
      walletBalances,
      solBalance: new Decimal(solBalance.value.toString()).div(1e9).toString(),
    };
  }

  private describeObligation(obligation: KaminoObligation): ObligationDetail {
    const market = this.requireMarket();
    const toLeg = (pos: Position): PositionLeg => {
      const reserve = market.getReserveByAddress(pos.reserveAddress);
      return {
        symbol: reserve?.symbol ?? String(pos.reserveAddress),
        reserveAddress: String(pos.reserveAddress),
        mintAddress: String(pos.mintAddress),
        amount: pos.amount.div(pos.mintFactor).toString(),
        valueUsd: pos.marketValueRefreshed.toFixed(4),
      };
    };

    const stats = obligation.refreshedStats;
    const adjustedDebt = stats.userTotalBorrowBorrowFactorAdjusted;
    return {
      obligationAddress: String(obligation.obligationAddress),
      type: OBLIGATION_TYPE_NAMES[obligation.obligationTag] ?? `Unknown(${obligation.obligationTag})`,
      deposits: obligation.getDeposits().map(toLeg),
      borrows: obligation.getBorrows().map(toLeg),
      totalDepositUsd: stats.userTotalDeposit.toFixed(4),
      totalBorrowUsd: stats.userTotalBorrow.toFixed(4),
      borrowLimitUsd: stats.borrowLimit.toFixed(4),
      liquidationLimitUsd: stats.borrowLiquidationLimit.toFixed(4),
      netAccountValueUsd: stats.netAccountValue.toFixed(4),
      ltv: stats.loanToValue.toFixed(6),
      liquidationLtv: stats.liquidationLtv.toFixed(6),
      healthFactor: adjustedDebt.gt(0) ? stats.borrowLiquidationLimit.div(adjustedDebt).toFixed(4) : null,
    };
  }

  /**
   * Spot balances of every token this market has a reserve for (both SPL Token and Token-2022).
   *
   * VERIFIED LIVE 2026-09-24: xStock mints carry Token-2022's scaledUiAmountConfig extension
   * (AAPLx multiplier ≈ 1.00266), so uiAmount (0.01274161 AAPLx) is larger than the raw balance
   * (1270010 base units = 0.0127001). Kamino moves raw units — depositing the uiAmount failed
   * simulation with "insufficient funds". `amount` is therefore raw-based.
   */
  async getWalletBalances(walletAddress: string): Promise<WalletBalance[]> {
    const market = this.requireMarket();
    const owner = address(walletAddress);
    const results = await Promise.all(
      [TOKEN_PROGRAM, TOKEN_2022_PROGRAM].map((programId) =>
        this.rpc.getTokenAccountsByOwner(owner, { programId: address(programId) }, { encoding: "jsonParsed" }).send()
      )
    );

    const byMint = new Map<string, { raw: Decimal; display: Decimal }>();
    for (const { value } of results) {
      for (const acc of value) {
        const info: any = (acc.account.data as any)?.parsed?.info;
        if (!info?.mint) continue;
        const prev = byMint.get(info.mint) ?? { raw: new Decimal(0), display: new Decimal(0) };
        byMint.set(info.mint, {
          raw: prev.raw.add(info.tokenAmount?.amount ?? "0"),
          display: prev.display.add(info.tokenAmount?.uiAmountString ?? "0"),
        });
      }
    }

    const balances: WalletBalance[] = [];
    for (const [mint, { raw, display }] of byMint) {
      const reserve = market.getReserveByMint(address(mint));
      if (reserve && raw.gt(0)) {
        const amount = raw.div(new Decimal(10).pow(reserve.getMintDecimals()));
        balances.push({
          symbol: reserve.symbol,
          mintAddress: mint,
          amount: amount.toString(),
          displayAmount: display.toString(),
          valueUsd: amount.mul(reserve.getOracleMarketPrice()).toFixed(4),
        });
      }
    }
    return balances;
  }

  /**
   * What a user can actually do with `symbol` in this market, from live data:
   *   - borrow: the reserve accepts it as collateral (LTV > 0) and USDC can be borrowed against it.
   *   - earn: the market's USDC supply reserve (the Phase 3 yield leg) is available.
   *   - multiply: Kamino has live Multiply-tagged positions for this collateral (the Phase 1
   *     evidence — present for SPYx, absent for AAPLx as of 2026-09-22).
   */
  /**
   * Below this age a cached result is served directly instead of re-fetching. VERIFIED 2026-10-02: each live call
   * does a real RPC getSlot() plus an HTTP round-trip to Kamino's leverage/metrics endpoint, and /api/simulate calls
   * this on every keystroke-driven re-simulation (same collateral symbol, just a different amount) — without this,
   * every single edit to a Borrow/Multiply amount repeated both of those round-trips for no reason, since LTV, APY
   * and Multiply-live-status don't meaningfully change within a few seconds.
   */
  private static readonly CAPABILITIES_TTL_MS = 20_000;

  async getAssetCapabilities(symbol: string): Promise<AssetCapabilities> {
    const cached = this.capabilitiesCache.get(symbol);
    if (cached && Date.now() - cached.at < KaminoClient.CAPABILITIES_TTL_MS) return cached.result;
    try {
      const live = await this.fetchAssetCapabilities(symbol);
      this.capabilitiesCache.set(symbol, { result: live, cachedAt: new Date().toISOString(), at: Date.now() });
      return live;
    } catch (err) {
      // Fallback: Kamino's leverage/metrics API (or the RPC) failed or timed out. Reuse the last
      // good result for this symbol rather than leaving the agent with no capability data —
      // clearly marked, so neither the agent nor a log reader mistakes it for fresh data.
      const liveError = (err as Error).message;
      if (!cached) throw err;
      console.warn(
        `[capabilities] FALLBACK: live capability check for ${symbol} failed (${liveError}); ` +
          `using cached result from ${cached.cachedAt}.`
      );
      return { ...cached.result, dataSource: "cache", fallback: { cachedAt: cached.cachedAt, liveError } };
    }
  }

  /** Last successful live getAssetCapabilities result per symbol (process lifetime), reused within CAPABILITIES_TTL_MS. */
  private capabilitiesCache = new Map<string, { result: AssetCapabilities; cachedAt: string; at: number }>();

  private async fetchAssetCapabilities(symbol: string): Promise<AssetCapabilities> {
    const market = this.requireMarket();
    const reserve = market.getReserveBySymbol(symbol);
    if (!reserve) {
      const reason = `"${symbol}" is not listed in this market.`;
      return {
        symbol,
        listed: false,
        dataSource: "live",
        borrow: { supported: false, reason },
        earn: { supported: false, reason },
        multiply: { supported: false, reason },
      };
    }

    const slot = await this.rpc.getSlot().send();
    const usdc = market.getReserveBySymbol("USDC");
    const ltv = reserve.stats.loanToValue;

    const metrics = await this.getMultiplyMetrics(symbol);
    const live = metrics.find((m) => Number(m.totalObligations) > 0);

    return {
      symbol,
      listed: true,
      dataSource: "live",
      oraclePriceUsd: reserve.getOracleMarketPrice().toString(),
      loanToValuePct: ltv * 100,
      liquidationThresholdPct: reserve.stats.liquidationThreshold * 100,
      borrow:
        ltv > 0 && usdc
          ? {
              supported: true,
              reason: `Accepted as collateral at ${(ltv * 100).toFixed(0)}% LTV; USDC is borrowable against it.`,
              debtSymbol: "USDC",
              debtBorrowApyPct: (usdc.totalBorrowAPY(slot) * 100).toFixed(4),
            }
          : { supported: false, reason: "Reserve has 0% LTV (or no USDC reserve) — not usable as borrow collateral." },
      earn: usdc
        ? {
            supported: true,
            reason: "USDC (borrowed against this asset, or already held) can be supplied to this market's USDC reserve.",
            supplySymbol: "USDC",
            supplyApyPct: (usdc.totalSupplyAPY(slot) * 100).toFixed(4),
          }
        : { supported: false, reason: "This market has no USDC reserve." },
      multiply: live
        ? {
            supported: true,
            reason: `Live Kamino Multiply positions exist for ${symbol} (debt: ${live.borrowSymbol}).`,
            debtSymbol: live.borrowSymbol,
            liveObligations: live.totalObligations,
            avgLeverage: live.avgLeverage,
            tvlUsd: live.tvl,
          }
        : {
            supported: false,
            reason: `No live Kamino Multiply strategy exists for ${symbol} — Multiply must not be proposed for it.`,
          },
    };
  }

  /**
   * Read-only: hits Kamino's live `GET /kamino-market/{market}/leverage/metrics` endpoint
   * (verified live against this exact market during the Multiply-vs-Leverage investigation)
   * and returns only the "Multiply"-tagged rows whose deposit reserve matches `symbol`.
   * Reserve addresses in the raw API response are resolved back to symbols via the
   * already-loaded market — the API itself only returns pubkeys, not tickers.
   *
   * Returns an empty array if the symbol has no live Multiply obligations recorded
   * (that's real signal, not an error — e.g. this was true for AAPLx as of 2026-09-22).
   */
  async getMultiplyMetrics(symbol: string): Promise<MultiplyMetric[]> {
    const market = this.requireMarket();
    const reserve = this.getReserve(symbol); // throws with a clear message if symbol is unknown

    const raw = await this.fetchLeverageMetrics();
    const targetAddress = String(reserve.address);

    return raw
      .filter((row) => row.tag === "Multiply" && row.depositReserve === targetAddress)
      .map((row) => {
        const depositReserve = market.getReserveByAddress(address(row.depositReserve));
        const borrowReserve = market.getReserveByAddress(address(row.borrowReserve));
        return {
          depositSymbol: depositReserve?.symbol ?? row.depositReserve,
          depositReserve: row.depositReserve,
          borrowSymbol: borrowReserve?.symbol ?? row.borrowReserve,
          borrowReserve: row.borrowReserve,
          tag: row.tag,
          tvl: row.tvl,
          avgLeverage: row.avgLeverage,
          totalBorrowed: row.totalBorrowed,
          totalDeposited: row.totalDeposited,
          totalBorrowedUsd: row.totalBorrowedUsd,
          totalDepositedUsd: row.totalDepositedUsd,
          totalObligations: row.totalObligations,
          updatedOn: row.updatedOn,
        };
      });
  }

  private leverageMetricsCache: { at: number; rows: RawLeverageMetric[] } | null = null;

  /**
   * The market's whole leverage/metrics list, cached for 60s. The endpoint returns every reserve
   * at once and took ~8s per call on 2026-09-24, so per-symbol callers (the agent's capability
   * checks, the landing snapshot's 10-asset table) share one download instead of repeating it.
   */
  private async fetchLeverageMetrics(): Promise<RawLeverageMetric[]> {
    if (this.leverageMetricsCache && Date.now() - this.leverageMetricsCache.at < LEVERAGE_METRICS_TTL_MS) {
      return this.leverageMetricsCache.rows;
    }
    const url = `${KAMINO_API_BASE}/kamino-market/${this.marketAddress}/leverage/metrics`;
    // Bounded, so a hung Kamino API surfaces as an error (and a cache fallback in
    // getAssetCapabilities) instead of stalling the agent mid-conversation.
    const res = await fetch(url, { signal: AbortSignal.timeout(KAMINO_API_TIMEOUT_MS) });
    if (!res.ok) {
      throw new Error(`Kamino leverage/metrics request failed (${res.status}) for market ${this.marketAddress}`);
    }
    const rows = (await res.json()) as RawLeverageMetric[];
    this.leverageMetricsCache = { at: Date.now(), rows };
    return rows;
  }

  /**
   * Read-only: checks whether `walletAddress` has an existing Kamino Multiply obligation
   * for `symbol`. The collateral/debt token pairing needed to derive the obligation's PDA
   * is taken from a live Multiply metrics row for this symbol (via getMultiplyMetrics) —
   * not assumed/hardcoded — so this throws if no live Multiply strategy exists for the
   * symbol at all (there is then no pairing to check an obligation against).
   */
  async getMultiplyObligation(walletAddress: string, symbol: string): Promise<MultiplyObligationSnapshot> {
    const market = this.requireMarket();
    const metrics = await this.getMultiplyMetrics(symbol);
    if (metrics.length === 0) {
      throw new Error(
        `No live Multiply strategy found for "${symbol}" — cannot determine the collateral/debt ` +
          `token pairing needed to check for an obligation. Call getMultiplyMetrics() first to verify ` +
          `Multiply actually exists for this symbol before calling this.`
      );
    }

    const collReserve = this.getReserve(symbol);
    const debtReserve = market.getReserveByAddress(address(metrics[0].borrowReserve));
    if (!debtReserve) {
      throw new Error(`Could not resolve borrow reserve ${metrics[0].borrowReserve} to a loaded reserve.`);
    }

    const owner = address(walletAddress);
    const obligationType = new MultiplyObligation(
      address(collReserve.getLiquidityMint()),
      address(debtReserve.getLiquidityMint()),
      PROGRAM_ID
    );
    const obligation = await market.getObligationByWallet(owner, obligationType);

    if (!obligation) {
      return { walletAddress, symbol, hasObligation: false };
    }

    const stats = obligation.refreshedStats;
    const deposit = obligation.getDeposits()[0];
    const borrow = obligation.getBorrows()[0];

    return {
      walletAddress,
      symbol,
      hasObligation: true,
      collateralAmount: deposit?.amount.toString(),
      debtAmount: borrow?.amount.toString(),
      netAccountValueUsd: stats.netAccountValue.toString(),
      ltv: stats.loanToValue.toString(),
    };
  }

  /**
   * Converts a human-readable amount (e.g. 0.005 AAPLx) into the raw base-unit integer
   * string the SDK actually expects (amount * 10^mint_decimals). buildDepositTxns/
   * buildBorrowTxns pass this straight into `new BN(...)`, which throws "Invalid character"
   * on any decimal point — VERIFIED LIVE 2026-09-23 by hitting exactly that crash before
   * this conversion existed.
   */
  private toRawAmount(mintAddress: string, amount: Decimal): string {
    const market = this.requireMarket();
    const reserve = market.getReserveByMint(address(mintAddress));
    if (!reserve) {
      throw new Error(`No reserve found for mint ${mintAddress} — can't determine its decimals.`);
    }
    const decimals = reserve.getMintDecimals();
    return amount.mul(new Decimal(10).pow(decimals)).toFixed(0);
  }

  /**
   * `amount` for a repay/withdraw: either a real human-readable amount, or the literal "max" — klend-sdk's own
   * convention for "all of it" is the protocol sentinel U64_MAX (a raw-unit string, not a scaled human number),
   * which the program resolves on-chain to the real current debt/collateral (including interest accrued since
   * the position was last read), rather than us approximating a "full" number that risks being short by a few
   * raw units of accrued interest by the time the transaction lands. Not a real token amount, so it bypasses
   * toRawAmount's decimal scaling entirely.
   */
  private toRawRepayOrWithdrawAmount(mintAddress: string, amount: Decimal | "max"): string {
    return amount === "max" ? U64_MAX : this.toRawAmount(mintAddress, amount);
  }

  /**
   * Builds (does NOT send) a deposit transaction — depositing an xStock as collateral.
   * Signing/sending is the caller's responsibility (wallet adapter / TransactionSigner),
   * kept separate deliberately so nothing in this file can move funds on its own.
   *
   * NOTE: buildDepositTxns takes a `TransactionSigner`, not a bare Address — wiring
   * this to a real wallet adapter (browser) or keypair signer (CLI/backend) is the
   * next concrete step once init/list/getPosition are confirmed working live.
   *
   * `amount` is human-readable (e.g. 0.005, not raw lamports) — converted internally.
   */
  async buildDepositTx(owner: any, mintAddress: string, amount: Decimal, useV2Ixs = true) {
    const market = this.requireMarket();
    const obligation = new VanillaObligation(PROGRAM_ID);
    return KaminoAction.buildDepositTxns(
      market,
      this.toRawAmount(mintAddress, amount),
      address(mintAddress),
      owner,
      obligation,
      useV2Ixs,
      undefined // scopeRefreshConfig — TODO: confirm whether this is required for xStock reserves specifically
    );
  }

  /** Builds (does NOT send) a borrow transaction against existing collateral. `amount` is human-readable. */
  async buildBorrowTx(owner: any, mintAddress: string, amount: Decimal, useV2Ixs = true) {
    const market = this.requireMarket();
    const obligation = new VanillaObligation(PROGRAM_ID);
    return KaminoAction.buildBorrowTxns(
      market,
      this.toRawAmount(mintAddress, amount),
      address(mintAddress),
      owner,
      obligation,
      useV2Ixs,
      undefined
    );
  }

  /**
   * Builds (does NOT send) a deposit of new collateral plus a borrow against it, as ONE
   * KaminoAction — so the borrow sees the deposit within the same transaction. Building them
   * as two separate actions and simulating each against current state cannot work for a
   * wallet with no collateral yet: the borrow alone would be simulated against an empty
   * obligation. Amounts are human-readable.
   */
  async buildDepositAndBorrowTx(
    owner: any,
    depositMint: string,
    depositAmount: Decimal,
    borrowMint: string,
    borrowAmount: Decimal,
    useV2Ixs = true
  ) {
    const market = this.requireMarket();
    return KaminoAction.buildDepositAndBorrowTxns(
      market,
      this.toRawAmount(depositMint, depositAmount),
      address(depositMint),
      this.toRawAmount(borrowMint, borrowAmount),
      address(borrowMint),
      owner,
      new VanillaObligation(PROGRAM_ID),
      useV2Ixs,
      undefined
    );
  }

  /**
   * Builds (does NOT send) a plain supply ("Earn") deposit: liquidity goes into the reserve and
   * the wallet receives the reserve's collateral tokens, earning supply APY — it is NOT posted
   * as obligation collateral. Unlike buildDepositTx, this touches no obligation, so it can be
   * appended after a borrow in the same transaction without the obligation-refresh accounts
   * going stale. `amount` is human-readable.
   */
  async buildSupplyTx(owner: any, mintAddress: string, amount: Decimal) {
    const market = this.requireMarket();
    return KaminoAction.buildDepositReserveLiquidityTxns(
      market,
      this.toRawAmount(mintAddress, amount),
      address(mintAddress),
      owner,
      new VanillaObligation(PROGRAM_ID),
      undefined
    );
  }

  /**
   * Builds (does NOT send) a repay of borrowed USDC against a Vanilla obligation. `amount` is human-readable, or
   * the literal "max" to repay the full debt (see toRawRepayOrWithdrawAmount).
   *
   * INVESTIGATED 2026-10-02 (klend-sdk source, not assumed): unlike buildDepositTx/buildBorrowTx,
   * KaminoAction.buildRepayTxns takes `currentSlot` as a REQUIRED (not optional) parameter — it's not just for
   * refresh-instruction staleness: when amount is the U64_MAX "repay everything" sentinel, the SDK computes the
   * real safe-repay amount from the obligation's recorded debt plus interest accrued up to currentSlot
   * (KaminoAction.updateWSOLAccount in the SDK). Partial repay is fully supported — any amount less than the
   * total debt is accepted as-is, same as a deposit amount.
   */
  async buildRepayTx(owner: any, mintAddress: string, amount: Decimal | "max", useV2Ixs = true) {
    const market = this.requireMarket();
    const currentSlot = await this.rpc.getSlot().send();
    return KaminoAction.buildRepayTxns(
      market,
      this.toRawRepayOrWithdrawAmount(mintAddress, amount),
      address(mintAddress),
      owner,
      new VanillaObligation(PROGRAM_ID),
      useV2Ixs,
      undefined,
      currentSlot
    );
  }

  /**
   * Builds (does NOT send) a withdraw of deposited collateral from a Vanilla obligation, redeemed straight back
   * to the real liquidity mint (e.g. AAPLx) in one step — klend-sdk's buildWithdrawTxns composes
   * WithdrawObligationCollateral + RedeemReserveCollateral itself (confirmed from the generated instruction
   * accounts: `userDestinationLiquidity`, no separate c-token destination). `amount` is human-readable, or "max"
   * to withdraw everything deposited in that reserve.
   */
  async buildWithdrawTx(owner: any, mintAddress: string, amount: Decimal | "max", useV2Ixs = true) {
    const market = this.requireMarket();
    return KaminoAction.buildWithdrawTxns(
      market,
      this.toRawRepayOrWithdrawAmount(mintAddress, amount),
      address(mintAddress),
      owner,
      new VanillaObligation(PROGRAM_ID),
      useV2Ixs,
      undefined
    );
  }

  /**
   * Builds (does NOT send) a full close of a Vanilla position: repays the entire USDC debt and withdraws the
   * entire collateral, as ONE atomic transaction — klend-sdk's own buildRepayAndWithdrawTxns, not two separate
   * actions merged by hand (repay must be composed before withdraw so the obligation's debt is already clear
   * when the withdraw's LTV check runs; the SDK handles that ordering, not us). Both legs use the U64_MAX
   * "everything" sentinel; the real amounts are resolved on-chain at execution.
   *
   * RENT, VERIFIED 2026-10-02 (klend program IDL inspected directly, not assumed): the klend program ships NO
   * "close obligation" instruction of any kind. This clears the debt and empties the collateral, but the
   * obligation PDA itself stays allocated on-chain afterward — its rent (~0.0177 SOL, measured in the Borrow
   * preflight: 17,637,760 lamports for the obligation account alone) is NOT returned to the user by this or any
   * other instruction this SDK exposes. Never describe this as recovering everything that was put in.
   */
  async buildCloseVanillaPositionTx(owner: any, collateralMint: string, debtMint: string, useV2Ixs = true) {
    const market = this.requireMarket();
    const currentSlot = await this.rpc.getSlot().send();
    return KaminoAction.buildRepayAndWithdrawTxns(
      market,
      U64_MAX,
      address(debtMint),
      U64_MAX,
      address(collateralMint),
      owner,
      currentSlot,
      new VanillaObligation(PROGRAM_ID),
      useV2Ixs,
      undefined
    );
  }

  /**
   * Builds (does NOT send) a Multiply deposit — opening (or adding to) a leveraged position:
   * deposit `symbol`, flash-borrow more of it, swap the flash-borrowed debt token into it via
   * Jupiter, and deposit+borrow against Kamino to repay the flash loan, all atomically.
   *
   * INVESTIGATION NOTE (Phase 4): unlike buildDepositTx/buildBorrowTx, this is NOT a simple
   * KaminoAction wrapper. klend-sdk's real Multiply builder (`getDepositWithLeverageIxs`)
   * composes the flash-loan/deposit/borrow legs itself, but requires the caller to supply a
   * real swap quoter+executor (no default ships with the SDK) — here, Jupiter (see jupiter.ts).
   * The collateral/debt token pairing is derived from a live getMultiplyMetrics() row, same as
   * getMultiplyObligation() — not assumed — so this throws if no live Multiply strategy exists
   * for the symbol yet.
   *
   * Returns a flat instruction array (already fully composed, in the correct order) plus any
   * address lookup tables the swap route needs — pass both to
   * execute.ts's buildUnsignedTransactionFromInstructions(), not buildUnsignedTransaction()
   * (that one is for KaminoAction-shaped Phase 2/3 builds).
   */
  async buildMultiplyDepositTx(
    owner: TransactionSigner,
    symbol: string,
    depositAmount: Decimal,
    targetLeverage: Decimal
  ): Promise<{ ixs: Instruction[]; lookupTables: Account<AddressLookupTable>[] }> {
    const market = this.requireMarket();
    const metrics = await this.getMultiplyMetrics(symbol);
    if (metrics.length === 0) {
      throw new Error(
        `No live Multiply strategy found for "${symbol}" — cannot determine the collateral/debt ` +
          `token pairing needed to build a Multiply deposit.`
      );
    }

    const collReserve = this.getReserve(symbol);
    const debtReserve = market.getReserveByAddress(address(metrics[0].borrowReserve));
    if (!debtReserve) {
      throw new Error(`Could not resolve borrow reserve ${metrics[0].borrowReserve} to a loaded reserve.`);
    }

    const collTokenMint = address(collReserve.getLiquidityMint());
    const debtTokenMint = address(debtReserve.getLiquidityMint());

    const rpc = this.rpc;
    const currentSlot = await rpc.getSlot().send();

    const scopeRefreshIx = await getScopeRefreshIxForObligationAndReserves(
      market,
      collReserve,
      debtReserve,
      undefined,
      undefined
    );

    // Initial rough price estimate (debt token in terms of coll token), used only to size a
    // placeholder tx that enumerates accounts for the real Jupiter quote request below — the
    // real price used for the actual swap comes from that live quote, not this estimate.
    const priceDebtToColl = debtReserve.getOracleMarketPrice().div(collReserve.getOracleMarketPrice());

    const decimalsByMint = new Map<string, number>([
      [collTokenMint, collReserve.getMintDecimals()],
      [debtTokenMint, debtReserve.getMintDecimals()],
    ]);
    const getMintDecimals = (mint: string): number => {
      const decimals = decimalsByMint.get(mint);
      if (decimals === undefined) {
        throw new Error(`No cached decimals for mint ${mint} — expected only collateral/debt mints here.`);
      }
      return decimals;
    };

    const quoter = createJupiterQuoter(getMintDecimals);
    const swapper = createJupiterSwapper(rpc, owner.address);

    const results = await getDepositWithLeverageIxs<JupiterQuoteResponse>({
      owner,
      kaminoMarket: market,
      debtTokenMint,
      collTokenMint,
      depositAmount,
      priceDebtToColl,
      slippagePct: new Decimal("1"), // 1% — matches the slippageBps used in the Jupiter quote request
      obligation: null, // no existing Multiply obligation assumed — a fresh one is derived below
      referrer: none(),
      currentSlot,
      targetLeverage,
      selectedTokenMint: collTokenMint, // depositing in the collateral token itself
      obligationTypeTagOverride: ObligationTypeTag.Multiply,
      scopeRefreshIx,
      quoteBufferBps: new Decimal("50"), // 0.5% buffer between quote and execution
      quoter,
      swapper,
      useV2Ixs: true,
    });

    const result = results[0];
    if (!result) {
      throw new Error("getDepositWithLeverageIxs returned no results.");
    }

    // The swap route's own ALT(s) only cover the swap-side accounts. A composed Kamino
    // Multiply deposit (flash loan + deposit + borrow + refreshes across 2 reserves) has
    // enough of its own accounts that the tx can still exceed Solana's 1232-byte limit
    // without also compressing those — VERIFIED LIVE 2026-09-23 (a real build hit exactly
    // this: 1712 bytes, 60 unique accounts, only 41 covered without this). The xStocks
    // market has its own lookup table covering its reserves/oracles — fetched live from
    // Kamino's API (matching getMultiplyMetrics' pattern) rather than hardcoded.
    const marketLookupTable = await this.getMarketLookupTable();
    const lookupTables = marketLookupTable ? [...result.lookupTables, marketLookupTable] : result.lookupTables;

    return { ixs: result.ixs, lookupTables };
  }

  private marketLookupTableCache: Account<AddressLookupTable> | null | undefined;

  /** The xStocks market's own address lookup table (from Kamino's API), or null if none is published. */
  async getMarketLookupTable(): Promise<Account<AddressLookupTable> | null> {
    if (this.marketLookupTableCache !== undefined) {
      return this.marketLookupTableCache;
    }
    const res = await fetch(`${KAMINO_API_BASE}/v2/kamino-market`);
    if (!res.ok) {
      this.marketLookupTableCache = null;
      return null;
    }
    const markets = (await res.json()) as Array<{ lendingMarket: string; lookupTable?: string }>;
    const market = markets.find((m) => m.lendingMarket === String(this.marketAddress));
    if (!market?.lookupTable) {
      this.marketLookupTableCache = null;
      return null;
    }
    const [lut] = await fetchAllAddressLookupTable(this.rpc, [address(market.lookupTable)]);
    this.marketLookupTableCache = lut;
    return lut;
  }
}
