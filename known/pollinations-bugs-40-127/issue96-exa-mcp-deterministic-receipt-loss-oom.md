# Exa MCP: caller-deterministic receipt loss — web_fetch_exa amplifies its own worker into a memory-limit crash, the crash discards the usage receipt, settlement is silently skipped, and Exa still bills the platform; admission is cost-0 so any positive (quest) balance qualifies

**Severity: medium-high (deterministic platform-funded spend; repeatable per request; reachable by the cheapest account tier; also a per-request small-balance overshoot vector).**

**Found: 2026-10-25. LIVE-VERIFIED (crash reproduced, zero pollen settled, Exa-side fetch work observed).**

## Summary

The exa MCP worker's `web_fetch_exa` tool takes two unbounded-at-the-zod-layer parameters:

```js
// apps/exa-mcp/worker.js:167-170
inputSchema: z.object({
    urls: z.array(z.url()).min(1),                       // no .max()
    maxCharacters: z.number().int().positive().optional(), // no upper bound
}),
```

and its response path buffers the **entire** result in memory:

```js
// apps/exa-mcp/worker.js:248-253
const response = await handler.fetch(request);
// "The stateless handler may finish a tool while its small JSON response
//  body is being read. Materialize it before attaching the usage..."
const body = await response.arrayBuffer();               // ← full buffer
return withMcpUsageHeaders(new Response(body, response), usage);
```

The usage receipt — the *only* thing gen's settlement reads — is attached by `withMcpUsageHeaders` **after** that buffer. If the tool result is large enough to exceed the Worker memory limit, the worker dies first, no receipt headers are ever produced, and gen's settlement logic skips silently:

```ts
// gen.pollinations.ai/src/routes/mcp.ts:210-213
const usage = parseMcpUsageHeaders(response.headers);
if (usage) {                       // ← null receipt => undefined => skipped
    await settleUsage(c, server, usage, startedAt);
```

Meanwhile the tool's own parameters are chosen so that Exa performs (and bills the platform for) the full 100-page fetch before the worker assembles the response.

## Live verification (2026-10-25)

1. **Pricing is linear in urls**: `web_fetch_exa {urls:[2 URLs]}` → `0.002` pollen settled (balance 1.79147168 → 1.78947168); `{urls:[100 URLs], maxCharacters:200}` → `0.10` pollen settled (1.78947168 → 1.68947168). Exa's own server caps are `urls ≤ 100` and `maxCharacters ≤ 1,000,000` (error strings returned verbatim through the tool).
2. **The crash**: `web_fetch_exa {urls:[100 large text pages (Project Gutenberg books ~1-5 MB each)], maxCharacters:1_000_000}` →
   ```
   HTTP 500 {"success":false,"error":{"message":"Worker exceeded memory limit.","code":"INTERNAL_ERROR"}}
   ```
   after 7.6 s (Exa visibly doing the page work), response length 0.00 MB.
3. **The free ride**: `pollenBudget` before the crash call = **1.68947168**, after = **1.68947168** — **exactly 0 pollen settled** for a 100-page Exa contents fetch the platform paid for.
4. Repeatable at will by any caller with *any positive balance* — admission for `usage_receipt` servers is `requireAccountFunds(c, 0)` (`routes/mcp.ts:198-203`), which a fresh quest-tier account passes, and the request never needs a valid platform API key beyond reaching the authenticated proxy.

Issue 37 documented the *accidental* version of this (invalid receipt → 500). This is the **caller-deterministic** version: the attacker does not need the receipt to be malformed — they need it to never exist.

## Secondary: cost-0 admission vs post-hoc settlement

`apiKeyReservedAmount: 0` by design ("Tool cost is known only after execution", `routes/mcp.ts:101-103`), so a caller whose balance is below the eventual cost still executes: a single 100-URL call ($0.10) from an account holding e.g. 0.05 pollen settles to **-0.05**, the same no-floor deduction path already reported for realtime in issue 85 (gap 4). Per-call overshoot is bounded by Exa's 100-URL cap, so this is the smaller half of the issue — but it composes with the crash primitive: every call is either free (crash) or can overshoot (settle), at the attacker's choice.

## Fix (minimal)

1. **Bound the parameters at the tool schema**: `urls: z.array(...).max(N)` with N ≤ 50 and `maxCharacters` ≤ ~200k (realistic reading use), rejecting before Exa is called.
2. **Stream or truncate the response** instead of `arrayBuffer()` — or catch the memory failure and emit a **fallback receipt** computed from the *requested* units (`urls.length`), so settlement still happens when the worker survives.
3. For the structural gap: settle usage_receipt servers from a **durable record** (e.g. the worker writes the usage to KV/DO before responding, and gen reconciles on timeout) rather than from response headers alone — this also fixes issue 37's class generically.
