import type { NextRequest } from "next/server";
import { ParityAgent } from "../../../../src/agent/core";
import { PythFeedClient } from "../../../../src/pyth/feeds";
import { composeIntent, parseAnswers } from "@/lib/server/intent";
import { fail, getParity, HttpError, requireWallet } from "@/lib/server/parity";
import { clientIp, rateLimit, rateLimitedResponse } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Each run is a full Claude tool-calling loop (real Anthropic spend, ~1-2 minutes), so it is limited hard:
// a few per IP per 10 minutes, and only a couple of runs at once across the whole server.
const RUNS_PER_10_MIN = 4;
const MAX_CONCURRENT = 2;
let running = 0;

/**
 * POST /api/intent { wallet, goal, asset, outlook, risk } — turns the wizard's four structured answers into an intent
 * sentence (lib/server/intent.ts) and runs the REAL agent on it: ParityAgent.handleIntent, unchanged. The reply is a
 * newline-delimited JSON stream: one {type:"tool"} line per real tool call as it happens, then a final
 * {type:"result"} carrying the agent's actual output (the accepted propose_strategy, or its plain-text explanation
 * when it could not reach a validated proposal), or {type:"error"}.
 */
export async function POST(req: NextRequest) {
  try {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) throw new HttpError(503, "The agent is not configured on this server (ANTHROPIC_API_KEY is missing).");
    const retryAfter = rateLimit(`intent:${clientIp(req)}`, RUNS_PER_10_MIN, 600_000);
    if (retryAfter !== null) return rateLimitedResponse(retryAfter, "agent runs");
    if (running >= MAX_CONCURRENT) throw new HttpError(503, "The agent is busy with other requests, try again in a minute.");

    const body = await req.json().catch(() => null);
    if (!body) throw new HttpError(400, "Body must be JSON.");
    const wallet = requireWallet(body.wallet);
    const answers = parseAnswers(body);
    const intent = composeIntent(answers);
    const { client } = await getParity();

    // A fresh agent per request: ParityAgent keeps per-run state (validations, checked capabilities).
    const agent = new ParityAgent(client, new PythFeedClient(process.env.PYTH_HERMES_URL ?? "https://hermes.pyth.network", process.env.PYTH_API_KEY), key);

    running++;
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const send = (o: unknown) => controller.enqueue(encoder.encode(JSON.stringify(o, (_k, v) => (typeof v === "bigint" ? v.toString() : v)) + "\n"));
        try {
          send({ type: "start", intent });
          const result = await agent.handleIntent(intent, wallet, (e) => {
            const out = e.output as { valid?: boolean; available?: boolean; projectedHealthFactor?: number | null; source?: string; referenceSession?: string; referenceAsOf?: string } | string | null;
            send({
              type: "tool",
              turn: e.turn,
              name: e.name,
              isError: e.isError,
              symbol: e.input?.symbol ?? e.input?.newDepositSymbol ?? null,
              valid: typeof out === "object" && out ? (out.valid ?? null) : null,
              available: typeof out === "object" && out ? (out.available ?? null) : null,
              projectedHealthFactor: typeof out === "object" && out ? (out.projectedHealthFactor ?? null) : null,
              // check_price_divergence: who answered (pyth | finnhub) and whether the reference was live, so the wizard labels it truthfully.
              source: typeof out === "object" && out ? (out.source ?? null) : null,
              referenceSession: typeof out === "object" && out ? (out.referenceSession ?? null) : null,
              referenceAsOf: typeof out === "object" && out ? (out.referenceAsOf ?? null) : null,
            });
          });
          send({ type: "result", intent, result });
        } catch (err) {
          console.error("[api/intent]", err instanceof Error ? err.message : err);
          send({ type: "error", error: err instanceof Error ? err.message : String(err) });
        } finally {
          running--;
          controller.close();
        }
      },
    });
    return new Response(stream, { headers: { "content-type": "application/x-ndjson", "cache-control": "no-store" } });
  } catch (err) {
    return fail(err);
  }
}
