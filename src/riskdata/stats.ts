/**
 * Read side of the risk dataset: collection status and honest gap statistics. Used by `/api/riskdata/status` and the
 * `/data` page. Reads the JSONL files directly (the collector is a separate process), memoizing finished days by
 * (path, size, mtime) so only changed files are re-read. Returns no raw Finnhub prices, ever, and no wallet data.
 */

import { statSync } from "node:fs";
import { finnhubEnabled } from "../finnhub/quote";
import { listFiles, readRows, SERIES, type SeriesName } from "./store";

/**
 * A statistic is shown only with at least this many samples behind it; below it the page says "not enough samples yet" and
 * the count. 200 because a 95th percentile estimated from fewer than ~200 points rests on fewer than 10 tail observations.
 * At 5-minute sampling that is about 2.5 trading days of open-session data per asset (78 samples a day) and about one day
 * of closed-session data (about 210 a day).
 */
export const MIN_SAMPLES_FOR_GAP_STATS = 200;

/**
 * Finnhub's terms (https://finnhub.io/terms-of-service, read 2026-10-06) say: "You hereby agree to not redistribute or
 * share access to data or derived results from the data obtained from Finnhub with anyone or any 3rd party without
 * written approval from Finnhub", and that plans are "strictly for personal use". A published gap statistic is a derived
 * result, so it stays withheld unless this is explicitly turned on once written approval exists.
 */
export const publishGapStats = () => finnhubEnabled() && process.env.RISKDATA_PUBLISH_GAP_STATS === "true";

/**
 * The oracle_gap series carries Finnhub-derived fields (reference price, session, gaps). Like the statistics, it is not
 * exposed (status, page, export) unless FINNHUB_ENABLED and RISKDATA_PUBLISH_GAP_STATS are BOTH on. Rows already collected
 * with Finnhub fields stay on local disk only.
 */
export const exposesFinnhubDerived = publishGapStats;

export interface SeriesStatus {
  series: SeriesName;
  firstSampleAt: string | null;
  lastSampleAt: string | null;
  count: number;
  /** Per source: rows in which that source failed, out of all rows. A null reason is never imputed. */
  errorRate: Record<string, { errors: number; of: number; rate: number }>;
}

export interface Status {
  collectingSince: string | null;
  lastUpdate: string | null;
  series: SeriesStatus[];
  /** True only when FINNHUB_ENABLED and RISKDATA_PUBLISH_GAP_STATS are both on. */
  gapStatisticsPublished: boolean;
  /** Whether a stock reference price is being collected at all (the opt-in Finnhub flag). */
  referenceSourceEnabled: boolean;
  minSamplesForGapStats: number;
  note: string;
}

interface FileSummary {
  count: number;
  first: string | null;
  last: string | null;
  errorCounts: Record<string, number>;
  /** |adjusted gap| samples by asset and session (oracle_gap only). Kept in memory, never serialised to a client. */
  gaps: Record<string, { open: number[]; closed: number[]; unknown: number[] }>;
}

const memo = new Map<string, { sig: string; summary: FileSummary }>();

function summarize(file: string, series: SeriesName): FileSummary {
  let sig = "";
  try {
    const st = statSync(file);
    sig = `${st.size}:${st.mtimeMs}`;
  } catch {
    sig = "gone";
  }
  const hit = memo.get(file);
  if (hit && hit.sig === sig) return hit.summary;
  const rows = readRows<any>(file);
  const summary: FileSummary = { count: rows.length, first: rows[0]?.ts ?? null, last: rows[rows.length - 1]?.ts ?? null, errorCounts: {}, gaps: {} };
  for (const r of rows) {
    for (const k of Object.keys(r.errors ?? {})) summary.errorCounts[k] = (summary.errorCounts[k] ?? 0) + 1;
    if (series === "oracle_gap" && typeof r.adjustedGapPct === "number" && Number.isFinite(r.adjustedGapPct)) {
      const g = (summary.gaps[r.asset] ??= { open: [], closed: [], unknown: [] });
      (g[r.session as "open" | "closed" | "unknown"] ?? g.unknown).push(Math.abs(r.adjustedGapPct));
    }
  }
  memo.set(file, { sig, summary });
  return summary;
}

export function getStatus(): Status {
  const out: SeriesStatus[] = [];
  for (const series of SERIES) {
    const files = listFiles(series);
    let count = 0;
    let first: string | null = null;
    let last: string | null = null;
    const errorCounts: Record<string, number> = {};
    for (const f of files) {
      const s = summarize(f, series);
      count += s.count;
      if (s.first && (!first || s.first < first)) first = s.first;
      if (s.last && (!last || s.last > last)) last = s.last;
      for (const [k, n] of Object.entries(s.errorCounts)) errorCounts[k] = (errorCounts[k] ?? 0) + n;
    }
    const errorRate: SeriesStatus["errorRate"] = {};
    for (const [k, n] of Object.entries(errorCounts)) errorRate[k] = { errors: n, of: count, rate: count ? n / count : 0 };
    out.push({ series, firstSampleAt: first, lastSampleAt: last, count, errorRate });
  }
  // Finnhub-derived series are not exposed unless explicitly published.
  const visible = out.filter((s) => s.series !== "oracle_gap" || exposesFinnhubDerived());
  const collected = visible.filter((s) => !s.series.endsWith("_backfill") && s.count > 0);
  return {
    collectingSince: collected.reduce<string | null>((m, s) => (s.firstSampleAt && (!m || s.firstSampleAt < m) ? s.firstSampleAt : m), null),
    lastUpdate: collected.reduce<string | null>((m, s) => (s.lastSampleAt && (!m || s.lastSampleAt > m) ? s.lastSampleAt : m), null),
    series: visible,
    gapStatisticsPublished: publishGapStats(),
    referenceSourceEnabled: finnhubEnabled(),
    minSamplesForGapStats: MIN_SAMPLES_FOR_GAP_STATS,
    note: "Market-level data only. Series ending _backfill are Kamino's own hourly history imported once and labelled backfilled; they are never mixed with collected rows.",
  };
}

const percentile = (sorted: number[], p: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))];

export interface GapCell {
  n: number;
  enough: boolean;
  medianAbsGapPct: number | null;
  p95AbsGapPct: number | null;
}
export interface GapRow {
  asset: string;
  open: GapCell;
  closed: GapCell;
}

/** Per asset, |adjusted gap| statistics split by session. A cell is only filled in above MIN_SAMPLES_FOR_GAP_STATS. */
export function getGapStats(): GapRow[] {
  const merged: Record<string, { open: number[]; closed: number[] }> = {};
  for (const f of listFiles("oracle_gap")) {
    for (const [asset, g] of Object.entries(summarize(f, "oracle_gap").gaps)) {
      const m = (merged[asset] ??= { open: [], closed: [] });
      m.open.push(...g.open);
      m.closed.push(...g.closed);
    }
  }
  const cell = (xs: number[]): GapCell => {
    const sorted = [...xs].sort((a, b) => a - b);
    const enough = sorted.length >= MIN_SAMPLES_FOR_GAP_STATS;
    return { n: sorted.length, enough, medianAbsGapPct: enough ? percentile(sorted, 0.5) : null, p95AbsGapPct: enough ? percentile(sorted, 0.95) : null };
  };
  return Object.keys(merged)
    .sort()
    .map((asset) => ({ asset, open: cell(merged[asset].open), closed: cell(merged[asset].closed) }));
}
