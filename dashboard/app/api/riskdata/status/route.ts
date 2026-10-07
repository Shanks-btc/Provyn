import { json, fail } from "@/lib/server/parity";
import { getStatus } from "../../../../../src/riskdata/stats";

export const dynamic = "force-dynamic";

/**
 * GET /api/riskdata/status: when the risk-data collector started and last wrote, how many rows each series holds, and
 * each source's error rate. Read straight from the collector's files. Market-level data only: no wallet data, no mint or
 * reserve addresses, and no Finnhub prices (the files hold them, this endpoint never returns them).
 */
export async function GET() {
  try {
    return json(getStatus());
  } catch (err) {
    return fail(err);
  }
}
