# Provyn — Test plan

Every check below runs against **real infrastructure**: Solana mainnet (read and simulate only),
Solana devnet (the send/confirm check), Kamino's API, Jupiter, Pyth Hermes and the Anthropic API.
There are no mocks. Mainnet checks never sign or send; they use `simulateTransaction` with
signature verification disabled.

Run everything from the repo root with a filled-in `.env` (see [README.md](README.md)).

## Backend checks

| Command | What it proves | Last verified | Result |
|---|---|---|---|
| `npm run check:market` | The xStocks market loads; lists the 10 xStock reserves (AAPLx, TSLAx, SPYx, QQQx, NVDAx, GOOGLx, HOODx, MSTRx, METAx, CRCLx) with real LTV and liquidation thresholds (AAPLx 40%/50%, SPYx 73%/75%, TSLAx 55%/65%) | 2026-09-24 | ✅ |
| `npm run check:multiply` | Reads Kamino's live leverage metrics: which xStocks have live Multiply positions | 2026-09-22 | ✅ SPYx yes, AAPLx no |
| `npm run check:execute` | Builds a small AAPLx deposit for a real AAPLx holder and simulates it on mainnet | 2026-09-24 | ✅ simulation success |
| `npm run check:yield` | Builds a 1 USDC deposit into the xStocks market's USDC reserve and simulates it | 2026-09-24 | ✅ simulation success |
| `npm run check:multiply-deposit` | Builds a SPYx Multiply open (flash loan + Jupiter swap + deposit/borrow, fitted under the 1232-byte limit with lookup tables) and simulates it | 2026-09-24 | ✅ simulation success |
| `npm run check:agent` | Full agent loop for two intents (AAPLx borrow/earn; SPYx leverage). The trace must show a real mainnet simulation inside `validate_strategy` (slot + compute units) and a `propose_strategy` accepted by the validation and capability-grounding gates | 2026-09-24 | ✅ both proposed; AAPLx borrow-only (Multiply correctly unavailable), SPYx 1.5× Multiply |
| `npm run check:send-devnet` | Devnet only, throwaway keypair: serialize → wallet-side sign → submit → confirm, plus the "failed" (on-chain error with logs) and "timeout" outcomes | 2026-09-24 | ✅ tx `njdQBENC…Hsh6` confirmed and finalized at slot 503430923 |
| `npm run check:feeds` | Fetches AAPLx's real-equity and wrapper prices from Pyth Hermes and computes the spread (needs `PYTH_API_KEY` with equity-feed entitlement) | 2026-09-24 | ⚠️ 403 from Hermes (entitlement). A per-feed probe with the same key: BTC/SOL/USDC → 200 with live prices; Equity.US.AAPL/SPY → 403; Crypto.AAPLX/SPYX (the xStocks' own feeds) → 403 "Not entitled" |
| `npm run check:price` | Price cross-check, Pyth first and Finnhub as a labelled fallback. **Real:** Finnhub quote + market-status for AAPL/SPY/TSLA; live `check_price_divergence` with Pyth blocked returns `source: "finnhub"` for AAPLx, SPYx and TSLAx (TSLAx also has no Pyth feed registered). **Mocked, labelled MOCK in the output:** Pyth success (Pyth still wins, `source: "pyth"`), Finnhub timeout and throw (returns `available:false` with both reasons, no crash), open/closed/stale-open market states, and 7 grounding cases (a Finnhub-only check described as "verified against Pyth" is rejected) | 2026-10-06 | ✅ all pass |
| `npm run check:price -- hung` | A REAL Finnhub timeout: Finnhub pointed at a local server that never answers | 2026-10-06 | ✅ `{ok:false}` after 24.2s (12s x 2 attempts) |
| Oracle vs Finnhub, UI multiplier | Kamino's oracle price per xStock token is the stock price times the mint's effective Token-2022 multiplier. Closed session: unadjusted ratios 1.0027 / 1.0053 / 0.9997 (AAPLx / SPYx / TSLAx) against multipliers 1.003269 / 1.005715 / 1; after dividing, gaps -0.057% / -0.040% / -0.029%. Open session (13:30 and 13:32 UTC): -0.54% to +0.14% | 2026-10-06 | ✅ adjustment required and applied |
| `npm run check:agent` (AAPLx only, `CHECK_AGENT_ONLY=AAPLx`) | Real agent borrow run with Pyth blocked: the proposal names Finnhub, says the market was closed and the reference is the last close, calls it a coarse check, and was accepted after one revision for an unrelated capability-grounding rejection | 2026-10-06 | ✅ proposal accepted, HF 2.12, slot 453911363 |
| `npm run collect` (risk-data collector) | Real run against live Kamino, Finnhub and mainnet RPC: 14:31 to 14:40 UTC, hard-killed, restarted 14:55 (about 16 min of collection in total, 60 oracle-vs-stock rows and 20 market-state rows). Every asset sampled: all ten xStocks. After the restart: the stale lock was taken over, buckets 14:45 and 14:50 are absent (not forward-filled, the gap equals the downtime), 60 rows with 60 unique keys (0 duplicates) | 2026-10-06 | ✅ |
| `npm run collect -- backfill` | Kamino's hourly reserve history imported into the separate `market_state_backfill` and `events_backfill` series, every row labelled `backfilled`: 10 xStocks x 10,818 hourly rows from 2025-07-11 15:00 to 2026-10-06 13:00 (108,180 rows) plus 10 historical LTV/liquidation-threshold changes (SPYx and QQQx 2026-02-04; GOOGLx, TSLAx and NVDAx 2026-02-23). On-chain side only: Finnhub's free tier has no history, so there is no stock price and no gap before collection began | 2026-10-06 | ✅ |
| `npm run check:riskdata` | The real sampling and storage code with MOCK sources on a throwaway directory: idempotency (same bucket, and after a restart with a new store), Finnhub timeout and Kamino timeout give null plus a reason while the other side stays real, one asset's read throwing nulls only that asset, no forward-fill, multiplier-change event written exactly once, no address-shaped strings, below-threshold statistics shown as "not enough samples" | 2026-10-06 | ✅ 16 of 16 |
| `node scripts/check-collector-failures.mjs` | The REAL collector process with Finnhub pointed at a server that never answers and the RPC at a closed port: 10 rows per series, all values null with reasons ("Finnhub took too long to respond", "kamino: fetch failed"), session `unknown`, exit code 0 | 2026-10-06 | ✅ |
| Storage and logs scanned for wallet-shaped strings | Every stored file (458) and the collector logs searched for 32 to 44 character base58 strings and the known test wallet prefixes | 2026-10-06 | ✅ none |
| `/api/riskdata/status` and `/data` | Status shows first/last sample, count per series and per-source error rate; the page shows "Collecting since", counts and last update. Gap statistics are withheld by default (Finnhub terms). With `RISKDATA_PUBLISH_GAP_STATS=true` every asset showed "Not enough samples yet (6 of 200)". `node scripts/check-breakpoints.mjs` at 375, 390, 768, 1024, 1280, 1440 and 1920 px: no horizontal overflow outside scroll containers at any width | 2026-10-06 | ✅ |
| **FINNHUB_ENABLED off (default): price check** `npm run check:price`, section 7 | Pyth blocked + flag off returns exactly `{available, symbol, error}` (no `finnhubError`, no mention of Finnhub); a counting mock proves Finnhub is called 0 times; Pyth success still wins; `getQuote` and `getMarketStatus` return `{ok:false, disabled:true}` without a request; flag back on restores the fallback path | 2026-10-06 | ✅ 6 of 6 |
| **FINNHUB_ENABLED off: collector** `npm run check:riskdata`, section 10 | Flag off: `onchain_price` rows written for every asset, Finnhub quote and market-status called 0 times, no `oracle_gap` row, no Finnhub-derived field in the rows; status hides `oracle_gap` and reports `referenceSourceEnabled:false`; flag on but publish off still hides it; both on exposes it | 2026-10-06 | ✅ 8 of 8 |
| **FINNHUB_ENABLED off: the real collector** `node scripts/check-collector-flag-off.mjs` | Real `collect.ts --once` against live Kamino with Finnhub pointed at a connection-counting local server: connections made to Finnhub **0**; series written `onchain_price` and `market_state` only; 10 real on-chain rows; 0 Finnhub-derived field names in any stored file | 2026-10-06 | ✅ |
| **FINNHUB_ENABLED off: Trade page** `node scripts/check-trade-band.mjs` | Chrome over the debugging protocol. Flag off: no live-price band in the page, **0** requests to `/api/trade/quote`, no mention of Finnhub or "unavailable"; the route answers 404 "Live price is not available." Flag on (temporary): band present ("Live price: $333.34 (market open)") with requests | 2026-10-06 | ✅ |
| **FINNHUB_ENABLED off: `/data`, status and export** | `/api/riskdata/status` shows only on-chain series and no Finnhub-derived field names; `/data` shows the on-chain wording, no gap-statistics section and no mention of Finnhub; `collect -- export` writes 120 rows with columns `ts, asset, kaminoOraclePriceUsd, uiMultiplier` only | 2026-10-06 | ✅ |
| Rows collected before the flag existed | The first 100 oracle-vs-stock rows (14:30 to 15:25 UTC) were written with Finnhub reference fields. They stay in `data/riskdata/oracle_gap` on local disk only (the folder is gitignored); their on-chain fields were copied to `onchain_price` (`collect -- migrate-onchain`) | 2026-10-06 | ✅ |

### What to look for in `check:agent`

- `get_position` reports holdings per reserve. Wallet `Gm1m…` holds **MSTRx** collateral, not
  AAPLx. That exact mislabel happened once before the per-reserve fix.
- `get_asset_capabilities`: AAPLx `multiply=false`, SPYx `multiply=true`.
- `validate_strategy` returns `simulation.ran: true` with a real `slot`. A failure includes the
  on-chain reason (e.g. `BorrowTooLarge`) and the agent revises.
- The final proposal carries `validation.simulatedAtSlot`, and its `assetCapabilities` lists only
  assets that were queried.

### Test wallets (real mainnet wallets, read/simulate only)

| Wallet | Holdings (re-checked by `get_position` on every run) |
|---|---|
| `A3iPNQiG7sCAmL4dsAVr9RFmjh9EJEbh4jHprpk4DxdP` | Spot AAPLx and other xStocks; no Kamino obligation |
| `BWEJgsSutAxMEWNXTUKSnBaWHHMpQikcHmbmFz8nqEnZ` | Spot SPYx; a small SPYx Multiply obligation |
| `Gm1mMs1Bs5imsbSMPoAFFCAcQHuBsZPmTeEE3uKRNLG2` | Vanilla obligation: **MSTRx** collateral, USDC debt |

## Frontend checks (`dashboard/`)

| Check | How | Last verified | Result |
|---|---|---|---|
| Production build | `cd dashboard && npm run build` (also `npm run lint`) | 2026-09-24 | ✅ clean, no warnings |
| Responsive layout | Headless Chrome at 375, 390, 768, 1024, 1280, 1440 and 1920px on `/` and `/trade`. Checks: no horizontal overflow; nav inline at md+ and hamburger below; section layouts per breakpoint; headline sizes; Trade column order (chart → long/short → orderbook below lg) | 2026-09-24 | ✅ all 7 widths |
| New landing sections (Why Solana/Pyth, Proof, closing CTA, footer) | Same 7 widths: no overflow; 2-col → stacked below lg; CTA photo self-hosted (0 requests to unsplash), `object-fit: cover`, fills the section; CTA buttons stacked full-width below sm; footer stacked + centered below md, brand-above-columns md–lg, side by side lg+. CTA text contrast measured against the rendered photo's worst pixel under each text box | 2026-09-24 | ✅ all 7 widths; small text ≥ 5.41:1, headline ≥ 6.92:1 |
| Landing figures | Come from `dashboard/lib/market-snapshot.json`, written by `npm run snapshot:landing`: live Kamino reads (APYs, LTV/liquidation thresholds, Multiply positions per asset, xStock reserve count), the agent's validator simulating borrow / borrow+earn / SPYx Multiply on mainnet (compute-unit range), and the devnet proof tx's real fee priced at Pyth's live SOL/USD. The page shows the check time and slot | 2026-09-24 | ✅ borrow / borrow+earn / SPYx + TSLAx Multiply all simulate: 281k–432k CU; fee 5,000 lamports (~$0.0006); 10 reserves |
| Wizard price-check label (`npx tsx scripts/check-wizard-label.ts`) | The real `describeEvent` over events for all states: Pyth, Finnhub with the market open, Finnhub market closed, Finnhub session unknown, unavailable, and a legacy recorded result with no `source` field. Fails if a Finnhub answer is ever labelled as Pyth. **On the pre-fix baseline all three Finnhub cases failed, each labelled "Cross-checked … with Pyth".** | 2026-10-06 | ✅ 6 of 6 after the fix |

### Wallet connection (`dashboard/`, mainnet-only)

| Check | How | Last verified | Result |
|---|---|---|---|
| Connect / disconnect through the app's real wallet-adapter code | Headless Chrome with a spec-compliant **Wallet Standard test wallet** injected into the page (the protocol Phantom and Solflare register through): modal → connect → truncated key in nav/hero/CTA → menu (copy, disconnect) → disconnect → reload. 32 checks, on the dev server and a production build | 2026-09-25 | ✅ all pass |
| Connect/disconnect make no RPC calls | Recorded every request during the flow | 2026-09-25 | ✅ zero requests to any Solana RPC host |
| Real Phantom / Solflare extension | **Manual** — needs an unlocked wallet in a real browser profile | not yet run | ⏳ see checklist in the phase report |

## Data licence review (2026-10-06)

What each provider's terms actually say, read from the primary documents. Nothing here is legal advice.

- **Finnhub** (finnhub.io/terms-of-service): "You hereby agree to not redistribute or share access to data or derived results from the data obtained from Finnhub with anyone or any 3rd party without written approval from Finnhub." and "All plan listed on Finnhub website is strictly for personal use unless explicitly stated otherwise." Plans are not available if you use the data "for your business or registering under your business name". Derived results are covered, so aggregate gap statistics are not exempt. Hence Finnhub is opt-in (`FINNHUB_ENABLED`, default off) and nothing public depends on it.
- **Kamino API** (api.kamino.finance): the docs state "No API key required for public endpoints". The API's own metadata points its `termsOfService` at the kamino.com homepage. The only terms document found is the Terms of Service for the Site (kamino.com/terms, "Last Updated: August 7, 2026"), which governs use of the web app: Permitted Uses are "informational purposes only as an aid to their own research, due diligence and financial decision making", and its Pricing Data clause says prices are "provided for informational and convenience purposes only" with no warranty of accuracy. **No published terms cover storing, caching or republishing API data, and no rate limit is documented.** Absence of a prohibition is not a grant. The backfill of Kamino's hourly history is therefore held locally and the `/data` page shows only counts and dates from it, never its values.
- **Pyth** (pyth.network/legal): the Terms of Use (updated Aug 7, 2025) cover the website. They grant "a limited, nonexclusive license to display and otherwise use portions of the Site solely for your own private, non-commercial informational purposes only" and say "You shall not extract or copy Pyth Network price feed data ... nor shall you use automated processes, such as web scraping, crawling, or unauthorized API access". The Disclaimer for Pyth Network Price Feeds is a liability disclaimer and grants no licence. The Hermes docs say only that "Hermes now requires an API Key" (since the 2026-08-26 Core upgrade). **No data-use licence for displaying Pyth prices was found, and the terms accepted when an API key is issued were not read.** Provyn does not currently display Pyth prices (the equity and xStock feeds return 403); if they start answering, read the API-key terms before showing any number.

## Deliberately not tested yet

- **Real mainnet transactions.** Deferred until the frontend's wallet-signing flow exists.
- **Pyth success path of the price check.** Still untested: it needs equity and xStock feed entitlement on our key (403 today). What IS tested: the Kamino-vs-Finnhub check, live (all three assets, market closed, and the open-session samples) and mocked (Pyth success wins, Finnhub failure, open, closed and stale-open states), see `check:price` above (run with the opt-in Finnhub flag on). With the flag off, the default, the check is Pyth then a disclosed "unavailable", and that is tested too.
- **Wallet connect, the agent API route, and the Portfolio/Earn/Borrow screens.** Later frontend
  phases.
