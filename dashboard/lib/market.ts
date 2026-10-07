import snapshot from "./market-snapshot.json";

/**
 * Market figures as last verified live against Kamino's xStocks market on Solana mainnet.
 * Written by `npm run snapshot:landing` at the repo root — refresh by rerunning it, never by
 * hand-editing numbers. This is a snapshot, not a live feed; the UI says so and shows when.
 */
export const market = snapshot;

export const pct = (n: number, digits = 2) => `${n.toFixed(digits)}%`;

/** Signed percentage with a real minus sign, e.g. "−1.37%". */
export const signedPct = (n: number, digits = 2) => `${n < 0 ? "−" : "+"}${Math.abs(n).toFixed(digits)}%`;

export const checkedAtLabel = () => {
  const d = new Date(market.checkedAt);
  const date = d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
  return `${date}, ${time} UTC`;
};

/**
 * The one rendered USDC borrow APY. The Strategies "Borrow" card and the Problem section's Provyn
 * card both display exactly this value, so the two can never show different numbers.
 */
export const borrowApyLabel = pct(market.usdc.borrowApyPct);

export type AssetSymbol = keyof typeof market.assets;

/** Every asset on the page (Capabilities cards), in page order. */
export const allAssets = Object.keys(market.assets) as AssetSymbol[];

/** Assets with / without live Kamino Multiply positions at the last snapshot, in page order. */
export const multiplyLiveAssets = allAssets.filter((s) => market.assets[s].multiply.obligations > 0);
export const multiplyNotLiveAssets = allAssets.filter((s) => market.assets[s].multiply.obligations === 0);

/**
 * "A", "A and B", "A, B, and C" (or "or"). `sep` is the separator between 3+ items: the landing page passes " — " (its copy
 * uses em-dashes instead of commas), every other page keeps the default ", ".
 */
export const listJoin = (items: string[], word: "and" | "or" = "and", sep = ", ") =>
  items.length <= 2 ? items.join(` ${word} `) : `${items.slice(0, -1).join(sep)}${sep}${word} ${items[items.length - 1]}`;

/** The landing page's list style: "A — B — and C". */
export const LANDING_SEP = ", ";

/**
 * Net carry of "borrow USDC, redeposit it" (supply APY − borrow APY). The landing Strategies card, the /earn
 * index card and the /earn/redeposit page all read these, so the caution framing follows the sign of the same
 * verified number everywhere and cannot drift between pages.
 */
export const carryNegative = market.usdc.netCarryPct < 0;
export const carryLabel = signedPct(market.usdc.netCarryPct);
export const carryNote = carryNegative
  ? "Provyn's agent won't recommend this until the math turns positive, it isn't right now."
  : "Supply APY currently exceeds borrow APY, the agent can consider this, sized conservatively.";
