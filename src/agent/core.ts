/**
 * Agent core: takes a stated intent ("I want yield without selling my AAPLx"),
 * reasons over live Kamino + Pyth data via tool calls, validates its candidate
 * strategy by simulating the real transactions against mainnet, and ends on a
 * propose_strategy call — never a silent execution. Execution (actually
 * signing/sending the Kamino tx) is a deliberate separate step, wired in the
 * dashboard once there's a real confirmation UI, not from inside this loop.
 */

import Anthropic from "@anthropic-ai/sdk";
import { KaminoClient, type AssetCapabilities } from "../kamino/client";
import { withRpcRetry } from "../kamino/rpc-retry";
import { PythFeedClient } from "../pyth/feeds";
import { findUngroundedCapabilityClaims, findUngroundedPriceSourceClaims } from "./grounding";
import { checkPriceDivergence, type PriceCheckDeps, type PriceCheckResult } from "./priceCheck";
import { tools } from "./tools";
import { StrategyValidator, strategyFingerprint, type StrategyInput, type ValidationResult } from "./validate";

const SYSTEM_PROMPT = `You are Provyn, an onchain prime brokerage agent for tokenized equities (xStocks) on Solana.

Your job: take a user's stated financial intent and recommend a concrete, conservative position using Kamino Lend as the borrow/collateral venue. You do not execute trades — you propose them via propose_strategy and stop.

Required sequence:
1. get_position for the wallet, and get_asset_capabilities for every asset you consider (list_xstock_reserves if the symbol might not exist).
2. check_price_divergence for any xStock you size a position against.
3. validate_strategy with a concrete candidate. If it returns valid: false, read problems / simulation.failureReason and revise — smaller amount, different collateral the wallet actually holds, or drop a leg — then validate again (up to 3 attempts). Never present a strategy that failed validation. If nothing validates, explain why in plain text and do not call propose_strategy.
4. propose_strategy with the validationId of the successful validation and exactly the same strategy fields, using the validated projectedHealthFactor.

Grounding in real position data:
- Only say the user "already has X deposited" if X appears in get_position's deposits. Use existingCollateralSymbol only for such an asset (in a Vanilla obligation). Never infer holdings from the user's wording — if the user says "my AAPLx" but get_position shows different collateral (or AAPLx only as a spot wallet balance), say what the data actually shows.
- A new deposit (newDepositSymbol/newDepositAmount) must come from the wallet's spot walletBalances and must not exceed that balance's "amount" (NOT "displayAmount" — xStock wallet displays are inflated by a Token-2022 scaling multiplier and cannot be deposited in full). Never populate a deposit field with 0 to mean "no new deposit" — omit it.
- Size borrows from real USD values, not from round numbers: the most you can borrow is roughly collateral valueUsd × LTV (get_position / get_asset_capabilities give both). Pick a borrow well under that so the validated projectedHealthFactor stays comfortably above 1.5.
- A tool call that errors for network reasons (e.g. "fetch failed", 429) is not a failed validation — retry the same call; it does not count toward your validation attempts.

Asset capabilities (verified live on this market; get_asset_capabilities is the authority for any asset):
- AAPLx: Borrow and Earn only. There is NO Kamino Multiply strategy for AAPLx — never propose Multiply (or leveraged looping) for AAPLx.
- SPYx: Borrow, Earn and Multiply.
- For any other asset, propose Multiply only if get_asset_capabilities returns multiply.supported: true.
- In every proposal, explicitly state which capabilities apply to the asset(s) involved (assetCapabilities field and in the summary), including what is NOT available and why.
- NEVER state any capability claim — supported OR unsupported — about an asset you have not queried with get_asset_capabilities in this conversation. That includes the borrowed/supplied asset (e.g. USDC): either call get_asset_capabilities for it, or leave it out of assetCapabilities and make no capability statement about it. Write every capability statement with its subject asset named on the same line (e.g. "AAPLx: Multiply ❌ — no live Kamino strategy"). propose_strategy is rejected if it contains a capability claim about an unqueried asset, or an assetCapabilities entry that doesn't match the tool result.
- If get_asset_capabilities returns dataSource: "cache", the live check failed and the data is from an earlier successful check (fallback.cachedAt) — say so in the risks.

Earn economics:
- Earn = supplying USDC to this market's USDC reserve at its live supply APY. If the USDC borrow APY is higher than the supply APY, an earn leg funded by borrowed USDC loses money (negative carry) — say so plainly with both rates, and prefer borrow-only (the user keeps the USDC for their own use) unless the user explicitly wants the earn leg anyway.

Risk rules:
- check_price_divergence says which source answered (source: "pyth" or "finnhub"). Always name that source exactly. NEVER say Pyth checked or verified a price unless source is "pyth".
- If it returns available: false (neither Pyth nor Finnhub could answer), you may still propose a strategy, but you MUST: (a) explicitly state in the summary that the independent Pyth price check was unavailable and the proposal relies solely on Kamino's internal pricing, (b) add "Pyth divergence check unavailable — reduced price visibility" as an explicit item in the risks array, and (c) size the position more conservatively than you otherwise would.
- If it returns source "finnhub", Pyth was unavailable and the cross-check compared Kamino's oracle price with Finnhub's real stock quote. You MUST: (a) say in the summary that Pyth was unavailable and the check used Finnhub, (b) add a risks item beginning "Pyth divergence check unavailable — Finnhub used as the reference" that also states the market session: if referenceSession is not "open", say the market was closed (or not confirmed live) and the reference is the last close from referenceAsOf, (c) if coarse is true, size exactly as conservatively as when the check is unavailable; if classification is "meaningful_divergence", treat it as a real risk and size down. Never describe a Finnhub result as a Pyth check.
- If source is "pyth": a spread over ~1-2% or a stale feed (either side older than ~60s) is a real risk — say so explicitly.
- Never propose a health factor below 1.5 without flagging it as high-risk in plain language. Err conservative.
- If list_xstock_reserves doesn't include the symbol the user mentioned, say so plainly rather than guessing at parameters.
- Keep the summary in plain English a non-crypto-native person could follow.`;

export interface ToolCallEvent {
  turn: number;
  name: string;
  input: any;
  output: any;
  isError: boolean;
}

export class ParityAgent {
  private anthropic: Anthropic;
  private kamino: KaminoClient;
  private pyth: PythFeedClient;
  private validator: StrategyValidator;
  /** Successful validations this run, by validationId — propose_strategy must match one. */
  private validations = new Map<string, ValidationResult>();
  /** get_asset_capabilities results the agent has actually seen this conversation, by symbol. */
  private checkedCapabilities = new Map<string, AssetCapabilities>();
  /** check_price_divergence results this run, by symbol — propose_strategy's price-source claims are checked against them. */
  private priceChecks = new Map<string, PriceCheckResult>();
  /** Finnhub is injectable so tests can force a timeout or a market state; defaults to the real module. */
  private priceDeps: PriceCheckDeps;

  constructor(kamino: KaminoClient, pyth: PythFeedClient, apiKey: string, priceOverrides?: Pick<PriceCheckDeps, "finnhub">) {
    this.anthropic = new Anthropic({ apiKey });
    this.kamino = kamino;
    this.pyth = pyth;
    this.validator = new StrategyValidator(kamino);
    this.priceDeps = { pyth, kamino, ...priceOverrides };
  }

  private async executeTool(name: string, input: any): Promise<any> {
    switch (name) {
      case "list_xstock_reserves":
        return this.kamino.listXStockReserves();

      case "get_position":
        return withRpcRetry(() => this.kamino.getPosition(input.walletAddress));

      case "get_asset_capabilities": {
        const caps = await withRpcRetry(() => this.kamino.getAssetCapabilities(input.symbol));
        this.checkedCapabilities.set(caps.symbol, caps);
        return caps;
      }

      case "check_price_divergence": {
        // Pyth first, Finnhub as a labelled fallback, else { available: false } — never throws.
        const result = await checkPriceDivergence(input.symbol, this.priceDeps);
        this.priceChecks.set(input.symbol, result);
        return result;
      }

      case "validate_strategy": {
        const { walletAddress, ...strategy } = input;
        const result = await withRpcRetry(() => this.validator.validate(walletAddress, strategy as StrategyInput));
        this.validations.set(result.validationId, result);
        return result;
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }

  /**
   * propose_strategy is only accepted when it carries the id of a *successful* validation of
   * exactly the same strategy — so nothing reaches the user that wasn't simulated on-chain.
   * Returns the rejection reason, or null if accepted.
   */
  private checkProposal(input: any): string | null {
    // Also rejects capability claims about assets never queried via get_asset_capabilities.
    const validation = this.validations.get(input.validationId);
    if (!validation) {
      return `validationId "${input.validationId}" was not returned by validate_strategy in this session. Validate first.`;
    }
    if (!validation.valid) {
      return `Validation ${input.validationId} FAILED (${validation.problems.join("; ")}). Revise and validate again; never propose a failed strategy.`;
    }
    const proposed = strategyFingerprint(input as StrategyInput);
    const validated = strategyFingerprint(validation.strategy);
    if (proposed !== validated) {
      return `Proposal fields differ from what was validated. Validated: ${validated}. Proposed: ${proposed}. Propose exactly the validated strategy, or validate the new one.`;
    }
    const ungrounded = findUngroundedCapabilityClaims(
      input,
      this.checkedCapabilities,
      this.kamino.listReserves().map((r) => r.symbol)
    );
    if (ungrounded.length > 0) {
      return `Ungrounded capability claims — fix and call propose_strategy again:\n- ${ungrounded.join("\n- ")}`;
    }
    const wrongSource = findUngroundedPriceSourceClaims(input, this.priceChecks);
    if (wrongSource.length > 0) {
      return `Price-check source misstated — fix and call propose_strategy again:\n- ${wrongSource.join("\n- ")}`;
    }
    return null;
  }

  /**
   * Runs the reasoning loop for one user intent + wallet, returning the final
   * proposal (or the last assistant text if it never called propose_strategy —
   * which should be treated as "the agent didn't reach a recommendation",
   * not silently ignored). `onToolCall` receives every tool call and its result.
   */
  async handleIntent(
    intent: string,
    walletAddress: string,
    onToolCall?: (event: ToolCallEvent) => void
  ): Promise<any> {
    this.validations.clear();
    this.checkedCapabilities.clear();
    this.priceChecks.clear();
    const messages: Anthropic.MessageParam[] = [
      {
        role: "user",
        content: `User wallet: ${walletAddress}\nStated intent: ${intent}`,
      },
    ];

    for (let turn = 0; turn < 14; turn++) {
      const response = await this.anthropic.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 3000,
        system: SYSTEM_PROMPT,
        tools: tools as Anthropic.Tool[],
        messages,
      });

      const toolUseBlocks = response.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
      );

      if (toolUseBlocks.length === 0) {
        // Model responded with plain text and no tool call — likely done, or stuck.
        const textBlock = response.content.find((b) => b.type === "text");
        return { proposed: false, message: textBlock?.text ?? "(no response)" };
      }

      messages.push({ role: "assistant", content: response.content });

      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const block of toolUseBlocks) {
        const input = block.input as any;

        if (block.name === "propose_strategy") {
          const rejection = this.checkProposal(input);
          onToolCall?.({ turn, name: block.name, input, output: rejection ?? "accepted", isError: !!rejection });
          if (!rejection) {
            // Terminal — the validated proposal goes to the caller for human confirmation.
            const validation = this.validations.get(input.validationId)!;
            return {
              proposed: true,
              ...input,
              validation: {
                validationId: validation.validationId,
                simulatedAtSlot: validation.simulation.ran ? validation.simulation.slot : null,
                unitsConsumed: validation.simulation.ran ? validation.simulation.unitsConsumed : null,
                projectedHealthFactor: validation.projectedHealthFactor,
              },
            };
          }
          toolResults.push({ type: "tool_result", tool_use_id: block.id, content: rejection, is_error: true });
          continue;
        }

        let result: any;
        let isError = false;
        try {
          result = await this.executeTool(block.name, input);
        } catch (err) {
          result = { error: (err as Error).message };
          isError = true;
        }
        onToolCall?.({ turn, name: block.name, input, output: result, isError });
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: JSON.stringify(result),
          is_error: isError,
        });
      }

      messages.push({ role: "user", content: toolResults });
    }

    return { proposed: false, message: "Agent did not reach a proposal within the turn limit." };
  }
}
