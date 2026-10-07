/**
 * Append-only storage for the equity-collateral risk dataset: rotated JSONL files, one file per series per UTC day.
 *
 *   <RISKDATA_DIR>/<series>/<YYYY-MM-DD>.jsonl      (default RISKDATA_DIR = ./data/riskdata)
 *
 * WHY JSONL and not SQLite: the dataset must survive restarts, redeploys and host moves and be trivial to back up and
 * export. Plain files need no native module (better-sqlite3 needs a prebuilt binary per OS/Node, and `node:sqlite` needs
 * Node 22.5+ while this repo supports Node 18+), `cp`/`rsync`/any object store backs them up, and a row is never
 * rewritten, so nothing can be silently corrupted by a crash mid-update (a torn last line is skipped on read). Volume is
 * small: ~10 assets x 288 rows/day x ~350 bytes is about 1 MB/day. Day rotation keeps every file small and lets readers
 * memoize finished days.
 *
 * Idempotent: every row has a key (series, asset, bucket). A key that already exists is never written again, so a
 * restart or a duplicate tick cannot double-write. No row ever contains a wallet address, mint or reserve address:
 * market-level data only.
 */

import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

export type SeriesName = "onchain_price" | "oracle_gap" | "market_state" | "events" | "market_state_backfill" | "events_backfill";
export const SERIES: SeriesName[] = ["onchain_price", "oracle_gap", "market_state", "events", "market_state_backfill", "events_backfill"];

/**
 * RISKDATA_DIR if set (use an absolute path on a server), else <repo root>/data/riskdata. The repo root is found by looking
 * for src/riskdata from the working directory or its parent, so the collector (run from the root) and the Next server (run
 * from dashboard/) read and write the SAME directory instead of two different relative ones.
 */
export const dataDir = () => {
  if (process.env.RISKDATA_DIR) return path.resolve(process.env.RISKDATA_DIR);
  const cwd = process.cwd();
  const root = existsSync(path.join(cwd, "src", "riskdata")) ? cwd : existsSync(path.join(cwd, "..", "src", "riskdata")) ? path.resolve(cwd, "..") : cwd;
  return path.join(root, "data", "riskdata");
};

const dayOf = (iso: string) => iso.slice(0, 10);
export const seriesDir = (series: SeriesName) => path.join(dataDir(), series);
const fileFor = (series: SeriesName, iso: string) => path.join(seriesDir(series), `${dayOf(iso)}.jsonl`);

export interface BaseRow {
  series: SeriesName;
  asset: string;
  /** Bucket-aligned ISO timestamp (UTC). With (series, asset) it is the idempotency key. */
  ts: string;
  source: "collected" | "backfilled";
  [k: string]: unknown;
}

/** Idempotency key. Events carry a discriminator so two different changes in one bucket both survive. */
export const rowKey = (r: { asset: string; ts: string; type?: unknown; field?: unknown }) => `${r.asset}|${r.ts}|${r.type ?? ""}|${r.field ?? ""}`;

/** All files of a series, oldest first. */
export function listFiles(series: SeriesName): string[] {
  const dir = seriesDir(series);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f))
    .sort()
    .map((f) => path.join(dir, f));
}

/** Parse one file; a torn or corrupt line is skipped, never fatal. */
export function readRows<T extends BaseRow = BaseRow>(file: string): T[] {
  const out: T[] = [];
  let text = "";
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return out;
  }
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as T);
    } catch {
      /* torn last line from a crash: skip */
    }
  }
  return out;
}

export class RiskStore {
  private keys = new Map<SeriesName, Set<string>>();

  /** Keys already on disk for this series' most recent files (today and yesterday cover every bucket a tick can target). */
  private load(series: SeriesName): Set<string> {
    let set = this.keys.get(series);
    if (set) return set;
    set = new Set<string>();
    for (const file of listFiles(series).slice(-2)) for (const r of readRows(file)) set.add(rowKey(r));
    this.keys.set(series, set);
    return set;
  }

  has(row: { series: SeriesName; asset: string; ts: string; type?: unknown; field?: unknown }): boolean {
    return this.load(row.series).has(rowKey(row));
  }

  /** Appends the row unless its key already exists. Returns whether it was written. */
  append(row: BaseRow): boolean {
    const set = this.load(row.series);
    const key = rowKey(row);
    if (set.has(key)) return false;
    mkdirSync(seriesDir(row.series), { recursive: true });
    appendFileSync(fileFor(row.series, row.ts), JSON.stringify(row) + "\n", "utf8");
    set.add(key);
    return true;
  }

  /** The most recent row (by file order) matching a predicate, scanning the last two day-files. */
  latest<T extends BaseRow>(series: SeriesName, pred: (r: T) => boolean): T | null {
    for (const file of listFiles(series).slice(-2).reverse()) {
      const rows = readRows<T>(file);
      for (let i = rows.length - 1; i >= 0; i--) if (pred(rows[i])) return rows[i];
    }
    return null;
  }
}

/** One collector per data directory: a second instance would double-sample. Stale locks (dead pid) are taken over. */
export function acquireLock(): () => void {
  mkdirSync(dataDir(), { recursive: true });
  const lock = path.join(dataDir(), "collector.lock");
  if (existsSync(lock)) {
    const pid = Number(readFileSync(lock, "utf8").trim());
    let alive = false;
    try {
      if (pid > 0) {
        process.kill(pid, 0);
        alive = pid !== process.pid;
      }
    } catch {
      alive = false;
    }
    if (alive) throw new Error(`Another collector (pid ${pid}) holds ${lock}. Stop it first.`);
  }
  writeFileSync(lock, String(process.pid));
  return () => {
    try {
      if (existsSync(lock) && readFileSync(lock, "utf8").trim() === String(process.pid)) unlinkSync(lock);
    } catch {
      /* best effort */
    }
  };
}

export const fileSize = (f: string) => {
  try {
    return statSync(f).size;
  } catch {
    return 0;
  }
};
