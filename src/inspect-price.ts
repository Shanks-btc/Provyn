/**
 * `npm run check:price [-- hung]`
 *
 * Verifies the price cross-check (Pyth first, Finnhub fallback). Real services where possible; anything mocked is
 * printed with MOCK in its label. Nothing is signed or sent, and no Anthropic spend (the agent run is `check:agent`).
 *
 *   npm run check:price          real Finnhub values, live fallback (Pyth blocked), mocked Pyth success,
 *                                injected Finnhub failure, open vs closed (live state + mocked), grounding cases
 *   npm run check:price -- hung  a REAL timeout: Finnhub pointed at a local server that never answers
 */
import "dotenv/config";
import http from "node:http";

// The Finnhub fallback is opt-in (default off). Sections 1 to 6 exercise it, so they run with the flag on; section 7 turns it off.
process.env.FINNHUB_ENABLED = "true";

async function hung() {
  const server = http.createServer(() => {}); // accepts the request, never answers
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  process.env.FINNHUB_BASE_URL = `http://127.0.0.1:${(server.address() as any).port}`;
  const { getQuote } = await import("./finnhub/quote");
  const t0 = Date.now();
  const r = await getQuote("AAPLx");
  console.log(`getQuote against a server that never answers -> ${JSON.stringify(r)} after ${((Date.now() - t0) / 1000).toFixed(1)}s (12s x 2 attempts expected)`);
  server.closeAllConnections();
  server.close();
  process.exit(r.ok ? 1 : 0);
}

async function main() {
  const { KaminoClient } = await import("./kamino/client");
  const { PythFeedClient } = await import("./pyth/feeds");
  const { getQuote, getMarketStatus } = await import("./finnhub/quote");
  const { checkPriceDivergence } = await import("./agent/priceCheck");
  const { findUngroundedPriceSourceClaims } = await import("./agent/grounding");

  const kamino = new KaminoClient(process.env.SOLANA_RPC_URL!, process.env.KAMINO_MAIN_MARKET!);
  await kamino.init();
  const realPyth = new PythFeedClient(process.env.PYTH_HERMES_URL ?? "https://hermes.pyth.network", process.env.PYTH_API_KEY);

  console.log("\n=== 1. REAL Finnhub quote and market status ===");
  console.log("market status:", JSON.stringify(await getMarketStatus()));
  for (const s of ["AAPLx", "SPYx", "TSLAx"]) console.log(s, JSON.stringify(await getQuote(s)));
  console.log("unsupported symbol QQQx:", JSON.stringify(await getQuote("QQQx")));

  console.log("\n=== 2. LIVE check_price_divergence, real Pyth (blocked) -> real Finnhub fallback ===");
  for (const s of ["AAPLx", "SPYx", "TSLAx"]) {
    console.log(`\n--- ${s} ---`);
    console.log(JSON.stringify(await checkPriceDivergence(s, { pyth: realPyth, kamino }), null, 2));
  }

  console.log("\n=== 3. MOCK Pyth success: Pyth must still win ===");
  const now = Math.floor(Date.now() / 1000);
  const mockPyth = {
    checkDivergence: async (symbol: string) => ({
      symbol,
      realPrice: { feedId: "mock", price: 100, confidence: 0.1, publishTimeUnix: now - 3 },
      onChainWrapperPrice: { feedId: "mock", price: 100.2, confidence: 0.1, publishTimeUnix: now - 4 },
      spreadPct: 0.2,
      staleness: { realFeedAgeSeconds: 3, wrapperFeedAgeSeconds: 4 },
    }),
  };
  const pythWins = await checkPriceDivergence("AAPLx", { pyth: mockPyth, kamino });
  console.log("MOCK Pyth success ->", JSON.stringify(pythWins));

  console.log("\n=== 4. INJECTED Finnhub failures: must return available:false like today, no crash ===");
  const failingFinnhub = {
    getQuote: async () => ({ ok: false as const, error: "Finnhub took too long to respond" }),
    getMarketStatus: async () => ({ ok: false as const, error: "Finnhub took too long to respond" }),
  };
  console.log("MOCK Finnhub timeout ->", JSON.stringify(await checkPriceDivergence("AAPLx", { pyth: realPyth, kamino, finnhub: failingFinnhub })));
  const throwingFinnhub = { getQuote: async () => { throw new Error("boom"); }, getMarketStatus: async () => { throw new Error("boom"); } };
  console.log("MOCK Finnhub throws ->", JSON.stringify(await checkPriceDivergence("AAPLx", { pyth: realPyth, kamino, finnhub: throwingFinnhub as any })));

  console.log("\n=== 5. MOCK market states (quote and status mocked; Kamino oracle and multiplier are REAL) ===");
  const real = await getQuote("AAPLx");
  if (!real.ok) throw new Error("need a real quote to base the mock on");
  const mk = (isOpen: boolean, session: string, ageSeconds: number, price = real.price) => ({
    getQuote: async () => ({ ...real, price, quoteTime: Math.floor(Date.now() / 1000) - ageSeconds }),
    getMarketStatus: async () => ({ ok: true as const, exchange: "US", isOpen, session, holiday: null, timezone: "America/New_York", time: Math.floor(Date.now() / 1000) }),
  });
  const oracle = await kamino.getOracleReference("AAPLx");
  const fair = oracle.oraclePriceUsd / (oracle.uiMultiplier ?? 1);
  const cases: [string, ReturnType<typeof mk>][] = [
    ["MOCK open, fresh quote, in line with Kamino", mk(true, "regular", 5, fair)],
    ["MOCK open, fresh quote, Kamino 3% above the quote (real divergence)", mk(true, "regular", 5, fair / 1.03)],
    ["MOCK closed, Kamino 3% above the last close (after-hours-sized gap)", mk(false, "post-market", 3600, fair / 1.03)],
    ["MOCK 'open' but last trade 40 min old", mk(true, "regular", 2400, fair)],
  ];
  for (const [label, finnhub] of cases) {
    const r: any = await checkPriceDivergence("AAPLx", { pyth: realPyth, kamino, finnhub });
    console.log(`${label}\n   -> session=${r.referenceSession} spread=${r.spreadPct?.toFixed(3)}% classification=${r.classification} coarse=${r.coarse}`);
  }

  console.log("\n=== 6. Grounding: price-source claims ===");
  const finnhubClosed = new Map([["AAPLx", { available: true, source: "finnhub", referenceSession: "closed" }]]);
  const pythOk = new Map([["AAPLx", { available: true, source: "pyth", referenceSession: "unknown" }]]);
  const none = new Map<string, any>([["AAPLx", { available: false }]]);
  const t = (label: string, proposal: { summary?: string; risks?: string[] }, checks: Map<string, any>, expectRejected: boolean) => {
    const problems = findUngroundedPriceSourceClaims(proposal, checks);
    const ok = (problems.length > 0) === expectRejected;
    console.log(`${ok ? "PASS" : "FAIL"}  ${label} -> ${problems.length > 0 ? "REJECTED" : "accepted"}`);
    if (!ok) { console.log(problems); process.exitCode = 1; }
  };
  t("Finnhub used, text says 'verified against Pyth'", { summary: "The price was independently verified against Pyth and matches Kamino.", risks: [] }, finnhubClosed, true);
  t("Finnhub used, honest text naming Finnhub + closed market", { summary: "Pyth was unavailable, so the price was cross-checked against Finnhub.", risks: ["Pyth divergence check unavailable — Finnhub used as the reference; the market was closed so it is the last close (coarse check)."] }, finnhubClosed, false);
  t("Finnhub used, text never names Finnhub", { summary: "Pyth was unavailable.", risks: ["Pyth divergence check unavailable — reduced price visibility; market closed."] }, finnhubClosed, true);
  t("Finnhub used while closed, no session note", { summary: "Pyth was unavailable; Finnhub was used as the reference.", risks: [] }, finnhubClosed, true);
  t("Pyth really answered, 'verified against Pyth'", { summary: "The price was verified against Pyth.", risks: [] }, pythOk, false);
  t("Nothing answered, text claims Pyth verified", { summary: "Pyth cross-check confirmed the price.", risks: [] }, none, true);
  t("Nothing answered, honest unavailable text", { summary: "The independent Pyth price check was unavailable.", risks: ["Pyth divergence check unavailable — reduced price visibility"] }, none, false);

  console.log("\n=== 7. FINNHUB_ENABLED off (the default): behaves exactly as before the fallback ===");
  const off = (name: string, ok: boolean, detail = "") => {
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
    if (!ok) process.exitCode = 1;
  };
  process.env.FINNHUB_ENABLED = "false";
  let finnhubCalls = 0;
  const countingFinnhub = {
    getQuote: async () => { finnhubCalls++; return { ok: false as const, error: "should not be called" }; },
    getMarketStatus: async () => { finnhubCalls++; return { ok: false as const, error: "should not be called" }; },
  };
  const offResult: any = await checkPriceDivergence("AAPLx", { pyth: realPyth, kamino, finnhub: countingFinnhub });
  off("Pyth blocked + flag off: { available: false, symbol, error } and nothing else", offResult.available === false && offResult.symbol === "AAPLx" && typeof offResult.error === "string" && !("finnhubError" in offResult) && Object.keys(offResult).sort().join() === "available,error,symbol", JSON.stringify(offResult).slice(0, 200));
  off("Finnhub was not called at all", finnhubCalls === 0, `calls: ${finnhubCalls}`);
  off("a flag-off result contains no mention of Finnhub", !/finnhub/i.test(JSON.stringify(offResult)));
  const offPyth: any = await checkPriceDivergence("AAPLx", { pyth: mockPyth, kamino, finnhub: countingFinnhub });
  off("flag off + Pyth success: Pyth still wins", offPyth.available === true && offPyth.source === "pyth" && finnhubCalls === 0);
  const offQuote: any = await getQuote("AAPLx");
  const offStatus: any = await getMarketStatus();
  off("getQuote / getMarketStatus return { ok:false, disabled:true } without a request", offQuote.ok === false && offQuote.disabled === true && offStatus.ok === false && offStatus.disabled === true, JSON.stringify(offQuote));
  process.env.FINNHUB_ENABLED = "true";
  const onResult: any = await checkPriceDivergence("AAPLx", { pyth: realPyth, kamino, finnhub: failingFinnhub });
  off("flag back on: the fallback path runs again (here: Finnhub mocked as failing)", onResult.available === false && typeof onResult.finnhubError === "string");
}

(process.argv.includes("hung") ? hung() : main()).catch((e) => {
  console.error("check:price failed:", e);
  process.exit(1);
});
