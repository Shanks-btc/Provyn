/**
 * Tool definitions exposed to the agent. Everything here is read-only or simulation-only:
 * validate_strategy builds real transactions and simulates them against mainnet, but never
 * signs or sends. propose_strategy is the agent's own reasoning output, not a chain call —
 * and it is only accepted once validate_strategy has passed for that exact strategy (enforced
 * in core.ts). An agent that can move funds with no human in the loop is a different (and much
 * higher-stakes) product than what we're building.
 */

/** The economic fields of a strategy — identical in validate_strategy and propose_strategy. */
const strategyProperties = {
  strategyType: {
    type: "string",
    enum: ["borrow", "borrow_and_earn", "earn", "multiply"],
    description:
      "borrow: post collateral (new or existing) and borrow USDC against it. " +
      "borrow_and_earn: borrow, then supply some/all of the borrowed USDC to the market's USDC reserve for yield. " +
      "earn: supply USDC the wallet already holds. " +
      "multiply: open/add to a leveraged position (flash loan + swap) — ONLY for assets whose get_asset_capabilities says multiply.supported.",
  },
  existingCollateralSymbol: {
    type: "string",
    description:
      "Collateral ALREADY deposited in the wallet's Vanilla obligation that a borrow builds on. Must appear in get_position's deposits — never taken from the user's wording.",
  },
  newDepositSymbol: {
    type: "string",
    description: "Asset being newly deposited (collateral for borrow, or the asset to lever for multiply). Omit if none.",
  },
  newDepositAmount: {
    type: "number",
    description: "Token amount of newDepositSymbol (not USD). Must not exceed the wallet's spot balance. Omit with newDepositSymbol.",
  },
  borrowSymbol: { type: "string", description: "Asset to borrow (USDC). Omit for earn and multiply." },
  borrowAmount: { type: "number", description: "Token amount to borrow. Omit for earn and multiply." },
  earnSymbol: { type: "string", description: "Asset supplied for yield (USDC). Only for earn / borrow_and_earn." },
  earnAmount: { type: "number", description: "Token amount supplied. For borrow_and_earn, at most borrowAmount." },
  targetLeverage: { type: "number", description: "Multiply only: target leverage, > 1 (e.g. 1.5)." },
};

export const tools = [
  {
    name: "list_xstock_reserves",
    description:
      "List all xStock reserves available as collateral on Kamino, with their " +
      "loan-to-value ratio and liquidation threshold. Call this first — never " +
      "assume a symbol exists or guess its risk parameters.",
    input_schema: {
      type: "object" as const,
      properties: {},
    },
  },
  {
    name: "get_position",
    description:
      "Get everything the wallet actually has in this market, from on-chain data: every obligation " +
      "(Vanilla, Multiply, …) with a per-reserve list of deposits and borrows (symbol, token amount, " +
      "USD value), health factor (liquidation at 1.0), plus the wallet's spot balances of listed tokens " +
      "(what it could newly deposit). depositedSymbols is the ONLY valid basis for saying the user " +
      "'already has X deposited'.",
    input_schema: {
      type: "object" as const,
      properties: {
        walletAddress: { type: "string", description: "User's Solana wallet address" },
      },
      required: ["walletAddress"],
    },
  },
  {
    name: "get_asset_capabilities",
    description:
      "Which products apply to an asset, from live data: borrow (usable as collateral to borrow USDC), " +
      "earn (USDC supply reserve, with live supply APY), multiply (live Kamino Multiply strategy exists). " +
      "Also returns the live USDC borrow APY. Call this for every asset you consider proposing.",
    input_schema: {
      type: "object" as const,
      properties: {
        symbol: { type: "string", description: "Reserve symbol, e.g. AAPLx" },
      },
      required: ["symbol"],
    },
  },
  {
    name: "check_price_divergence",
    description:
      "Independent price cross-check for an xStock. Tries Pyth first (real equity price vs the " +
      "xStock's on-chain feed); if Pyth cannot answer AND the optional Finnhub fallback is enabled on this " +
      "server, uses Finnhub (Kamino's oracle price, adjusted by the token's UI multiplier, vs Finnhub's " +
      "real stock quote); otherwise it reports available: false. The result says which " +
      "answered (source: \"pyth\" | \"finnhub\"), the market session, and whether the check is coarse. " +
      "Use this before proposing any position sized against an xStock — a large spread or stale feed " +
      "is a reason to size down or flag risk to the user, not something to silently ignore. Never " +
      "attribute a Finnhub result to Pyth.",
    input_schema: {
      type: "object" as const,
      properties: {
        symbol: { type: "string", description: "xStock symbol, e.g. AAPLx" },
      },
      required: ["symbol"],
    },
  },
  {
    name: "validate_strategy",
    description:
      "Build the real transaction(s) for a candidate strategy and simulate them atomically against " +
      "live Solana mainnet state for this wallet (no signing, no sending). Returns valid, the " +
      "simulation result (slot, compute units, failure reason and key program logs) and a projected " +
      "health factor. REQUIRED before propose_strategy: the proposal must reuse the returned " +
      "validationId and exactly the same strategy fields. If valid is false, revise (smaller amount, " +
      "different collateral, drop a leg) and validate again.",
    input_schema: {
      type: "object" as const,
      properties: {
        walletAddress: { type: "string", description: "User's Solana wallet address" },
        ...strategyProperties,
      },
      required: ["walletAddress", "strategyType"],
    },
  },
  {
    name: "propose_strategy",
    description:
      "Present the final, already-validated action to the user for confirmation. This does NOT " +
      "execute anything. Rejected unless validationId refers to a successful validate_strategy " +
      "call with exactly the same strategy fields.",
    input_schema: {
      type: "object" as const,
      properties: {
        summary: { type: "string", description: "Plain-language explanation of the recommendation" },
        validationId: { type: "string", description: "validationId from a validate_strategy call that returned valid: true" },
        ...strategyProperties,
        projectedHealthFactor: { type: "number", description: "Use the projectedHealthFactor validate_strategy returned" },
        assetCapabilities: {
          type: "array",
          description: "For each asset involved, which of Borrow / Earn / Multiply apply (from get_asset_capabilities).",
          items: {
            type: "object",
            properties: {
              symbol: { type: "string" },
              supported: { type: "array", items: { type: "string", enum: ["Borrow", "Earn", "Multiply"] } },
              notSupported: { type: "array", items: { type: "string", enum: ["Borrow", "Earn", "Multiply"] } },
            },
            required: ["symbol", "supported", "notSupported"],
          },
        },
        risks: {
          type: "array",
          items: { type: "string" },
          description: "Explicit risk flags — e.g. price divergence, feed staleness, liquidation proximity, negative carry",
        },
      },
      required: ["summary", "validationId", "strategyType", "assetCapabilities", "risks"],
    },
  },
];
