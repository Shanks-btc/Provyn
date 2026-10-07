/**
 * Guards propose_strategy against capability claims the agent never checked.
 *
 * WHY (Phase 5 review): the first accepted AAPLx proposal listed "USDC — Borrow: not supported"
 * without ever calling get_asset_capabilities("USDC"). The claim was invented, not looked up.
 *
 * Two checks:
 *  1. Structured: every assetCapabilities entry must be for a symbol queried in this conversation,
 *     and its supported/notSupported lists must match what get_asset_capabilities returned.
 *  2. Text (summary + risks): a line that makes a capability claim (a capability word — borrow,
 *     earn, multiply, leverage, … — plus a claim marker — supported, available, ✅/❌, "does not
 *     support", …) and names an asset that was never queried is rejected, unless the line's
 *     subject is a queried asset named on the same line (e.g. "AAPLx: Earn ✅ — supply USDC for
 *     yield" is a claim about AAPLx; "✅ Earn: USDC can be supplied" alone is not attributable).
 *     Deliberately strict: a false positive costs the agent one get_asset_capabilities call or a
 *     rephrase; a false negative is exactly the ungrounded claim this exists to stop.
 */

import type { AssetCapabilities } from "../kamino/client";

type Capability = "Borrow" | "Earn" | "Multiply";

const CAPABILITY_WORD = /\b(borrow\w*|earn\w*|multiply|leverag\w*|loop\w*|collateral)\b/i;
const CLAIM_MARKER =
  /\b(supported|unsupported|available|unavailable|capabilit\w*)\b|✅|❌|✓|✗|does(?:n['’]t| not) (?:support|offer|allow)|can(?:not|['’]t) be (?:used|borrowed|levered|looped|supplied)|\bno (?:live )?(?:kamino )?(?:multiply|leverage)\b/i;

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function actualCapabilities(caps: AssetCapabilities): { supported: Capability[]; notSupported: Capability[] } {
  const all: [Capability, boolean][] = [
    ["Borrow", caps.borrow.supported],
    ["Earn", caps.earn.supported],
    ["Multiply", caps.multiply.supported],
  ];
  return {
    supported: all.filter(([, ok]) => ok).map(([c]) => c),
    notSupported: all.filter(([, ok]) => !ok).map(([c]) => c),
  };
}

export function findUngroundedCapabilityClaims(
  proposal: { summary?: string; risks?: string[]; assetCapabilities?: { symbol: string; supported?: string[]; notSupported?: string[] }[] },
  checked: Map<string, AssetCapabilities>,
  marketSymbols: string[]
): string[] {
  const problems: string[] = [];

  // 1. Structured assetCapabilities entries.
  for (const entry of proposal.assetCapabilities ?? []) {
    const caps = checked.get(entry.symbol);
    if (!caps) {
      problems.push(
        `assetCapabilities lists "${entry.symbol}", but get_asset_capabilities("${entry.symbol}") was never called in this conversation.`
      );
      continue;
    }
    const actual = actualCapabilities(caps);
    const same = (a: string[] = [], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));
    if (!same(entry.supported, actual.supported) || !same(entry.notSupported, actual.notSupported)) {
      problems.push(
        `assetCapabilities for ${entry.symbol} (supported ${JSON.stringify(entry.supported ?? [])}, notSupported ` +
          `${JSON.stringify(entry.notSupported ?? [])}) does not match get_asset_capabilities (supported ` +
          `${JSON.stringify(actual.supported)}, notSupported ${JSON.stringify(actual.notSupported)}).`
      );
    }
  }

  // 2. Free-text claims in summary and risks, line by line.
  const symbolRes = marketSymbols.map((sym) => ({ sym, re: new RegExp(`(^|[^A-Za-z0-9])${escapeRe(sym)}(?![A-Za-z0-9])`) }));
  const lines = [...(proposal.summary ?? "").split(/\n+/), ...(proposal.risks ?? [])]
    .flatMap((block) => block.split(/(?<=[.!?])\s+(?=[A-Z*✅❌-])/))
    .map((l) => l.trim())
    .filter(Boolean);

  for (const line of lines) {
    if (!CAPABILITY_WORD.test(line) || !CLAIM_MARKER.test(line)) continue;
    const mentioned = symbolRes.filter(({ re }) => re.test(line)).map(({ sym }) => sym);
    const unqueried = mentioned.filter((s) => !checked.has(s));
    if (unqueried.length === 0) continue;
    const hasQueriedSubject = mentioned.some((s) => checked.has(s));
    if (!hasQueriedSubject) {
      problems.push(
        `Capability claim mentions ${unqueried.join(", ")} without get_asset_capabilities for it: "${line.slice(0, 200)}". ` +
          `Query it first, or rephrase so the claim is explicitly about an asset you did query.`
      );
    }
  }

  return problems;
}

// ---------------------------------------------------------------------------------------------------------------------
// Price-check source grounding: the same idea as capability grounding, for "who verified the price".
//
// WHY: with a Finnhub fallback behind Pyth, the agent could blur the two and write "price verified against Pyth" on a
// proposal whose only price check came from Finnhub (or from nothing). A false "Pyth verified" is exactly the kind of
// unchecked claim this product exists to prevent.
//
// Two rules, over the summary and risks (and the tool results the agent actually received this turn):
//  1. A line that presents Pyth as the thing that checked/verified a price is rejected unless a price check this run
//     really came from Pyth. Lines that disclose Pyth was unavailable/blocked/not used are fine.
//  2. If a price check came from Finnhub, the proposal must name Finnhub, and (when the session was not live) must say
//     the market was closed / the reference is the last close.
// Deliberately strict, like the capability gate: a false positive costs one rephrase; a false negative is the lie.
// ---------------------------------------------------------------------------------------------------------------------

const PYTH_NAMED = /\bpyth\b/i;
const VERIFY_MARKER = /\b(verif\w*|cross-?check\w*|check(?:ed|s)?|confirm\w*|validat\w*|match(?:es|ed)?|agree\w*|independent\w*|divergence|spread|compar\w*)\b/i;
const PYTH_DISCLOSURE = /\b(unavailable|not available|blocked|could not|couldn['’]t|can(?:not|['’]t)|unable|failed|fail(?:s|ure)?|403|not entitled|entitle\w*|without pyth|instead of pyth|rather than pyth|not pyth|no pyth|fallback|did(?:n['’]t| not)|was(?:n['’]t| not)|is(?:n['’]t| not)|not (?:used|run|checked|verified))\b/i;
const SESSION_NOTE = /\b(closed|last close|after-?hours|pre-?market|not (?:confirmed )?live|stale|coarse)\b/i;

export function findUngroundedPriceSourceClaims(
  proposal: { summary?: string; risks?: string[] },
  checks: Map<string, { available: boolean; source?: string; referenceSession?: string }>
): string[] {
  const problems: string[] = [];
  const results = [...checks.values()];
  const pythAnswered = results.some((r) => r.available && r.source === "pyth");
  const finnhubUsed = results.filter((r) => r.available && r.source === "finnhub");

  const text = [proposal.summary ?? "", ...(proposal.risks ?? [])].join("\n");
  const lines = text
    .split(/\n+/)
    .flatMap((block) => block.split(/(?<=[.!?])\s+(?=[A-Z*✅❌-])/))
    .map((l) => l.trim())
    .filter(Boolean);

  if (!pythAnswered) {
    for (const line of lines) {
      if (PYTH_NAMED.test(line) && VERIFY_MARKER.test(line) && !PYTH_DISCLOSURE.test(line)) {
        problems.push(
          `This line presents Pyth as the price verifier, but no check_price_divergence result this run came from Pyth ` +
            `(${results.length === 0 ? "none was called" : `source: ${results.map((r) => (r.available ? r.source : "unavailable")).join(", ")}`}): "${line.slice(0, 200)}". ` +
            `Say what actually happened: Pyth was unavailable, and name the source that answered (or that none did).`
        );
      }
    }
  }

  if (finnhubUsed.length > 0) {
    if (!/finnhub/i.test(text)) {
      problems.push(`The price cross-check used Finnhub (Pyth was unavailable), but the summary and risks never name Finnhub. Name the source that actually answered.`);
    }
    if (finnhubUsed.some((r) => r.referenceSession !== "open") && !SESSION_NOTE.test(text)) {
      problems.push(
        `The Finnhub reference was not a live quote (market closed or not confirmed live, so it is the last close), but the proposal does not say so. State the market session and that the check is coarse.`
      );
    }
  }

  return problems;
}
