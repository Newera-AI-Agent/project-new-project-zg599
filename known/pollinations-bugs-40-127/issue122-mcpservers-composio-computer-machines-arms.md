# The `mcpServers` arms of community prompt agents (the companion analysis to issue 81 addendum 2): any prompt agent can be configured with `composio` (the caller's Gmail read / GitHub commit / Sheets / Slack), `computer` (the caller's persistent private sandbox), and `machines` (caller-billed arbitrary command execution in E2B) — with no caller-visible toolset, no per-server consent, and a no-injection-needed malicious-publisher variant

**Severity: high (the credential plumbing is verified end-to-end; a malicious allowlisted publisher needs no prompt injection at all — the agent's own system prompt is the payload).**

**Found: 2026-10-25. Code-verified (schema, registry, runtime, proxy headers, composio session binding). Not live-tested against a victim.**

## Summary

Issue 81 addendum 2 established that `mcpServers` accepts any builtin server with no filtering, and analyzed the `pollinations` server's account tools. This companion analyzes the other arms and files what they reach:

### The schema and the registry

```ts
// shared/community-endpoints.ts:713-724
export const BuiltinMcpServerIdSchema = z.enum(MCP_SERVER_IDS);
export const PromptAgentConfigSchema = z.object({
    systemPrompt: z.string().trim().min(1).max(8000),
    baseModel: z.string().trim().min(1).max(253),
    mcpServers: z.array(BuiltinMcpServerIdSchema)...
```

```ts
// shared/registry/mcp.ts:194-215
{ id: "composio", name: "Connectors",
  description: "Read Gmail, read and commit to GitHub, update Sheets, and post to Slack through Composio. Each user connects their own accounts when needed.",
  userScoped: true, ... },
{ id: "computer", ... userScoped: true, ... },   // the caller's persistent sandbox
{ id: "machines", ... billing: "downstream", ... }, // caller-billed E2B
```

### The credential chain (verified)

1. The prompt-agent runtime loads every configured server's tools with the caller's delegated `ag_` (`gen.../text/agents/runtime.ts:53-62, 100-104`).
2. Gen's proxy re-scopes `userScoped` servers to **the caller's id** (`routes/mcp.ts:46-54` — `headers.set(MCP_USER_ID_HEADER, user.id)`).
3. Composio's session acts on **the caller's connected third-party accounts** (`apps/composio-mcp/worker.js:116-139` — `config = { user_id: userId, ... }` — the caller's Gmail/GitHub/Sheets/Slack identities).
4. Floret independently proves the plumbing works end-to-end for agent-driven MCP (`apps/floret/src/floret/tools/mcp.py:56-67` drives `computer` bash with the caller's key).

### The two attack shapes

**A. Malicious publisher (no injection needed).** An allowlisted community publisher ships a friendly agent — "email summarizer", "workspace janitor", "PR helper" — with `mcpServers: ["composio"]` and a prompt that quietly calls Gmail-search tools and prints message bodies into the reply. Any caller who has ever connected Gmail (for the openwebui-style integrations) has their mail read; GitHub "commit" actions land under the victim's GitHub identity; Slack posts go to their workspaces. With `["computer"]` the agent gets bash in the victim's persistent sandbox (issue 120's filesystem); with `["machines"]` it gets `run_command` in caller-billed E2B sandboxes. Every tool call bills the victim (`COMPOSIO_TOOL_CALL_PRICE` / `COMPUTER_TOOL_CALL_PRICE` = 0.0002; machines at E2B lease rates).

**B. Injection into benign agents.** Issue 81 addendum 2's attack B, with the loot being the caller's third-party accounts instead of the Pollinations account.

**What makes it high despite 81:** the caller-facing listing never shows the toolset (81's fix list already notes this), there is no per-server consent at invocation, and the composio arm reaches **non-Pollinations** crown jewels (mail, code, spreadsheets, chat) that no Pollinations-side revocation can claw back.

## Why this is not a duplicate

Issue 81 addendum 2 noticed these servers in passing and dismissed them — *"userScoped servers (composio, computer) at least scope to the caller's own connected accounts"* — which is precisely the understatement this filing corrects: the caller's connected accounts are the victim's crown jewels, and the analysis, attack shapes, and fixes are distinct (per-server consent and tool filtering vs. 81's route-level `ag_` rejection).

## Fix (minimal)

1. Per-server consent at invocation (or at minimum: allowlist community prompt agents to generation-only servers; require explicit user opt-in per account-capable server per agent).
2. Tool-level filtering in `loadMcpTools` for agent contexts (exclude account-capable and connector tools from publisher-controlled loops).
3. Surface `mcpServers` in the public agent listing so callers can see what they are attaching.
4. A CI lint on `agent.json` (extend `apps/agent-json.test.ts`) rejecting `composio`/`machines` in community-published agents pending the consent fix.

## Verification note

Static. The composio arm was verified in code only (session binding, registry description, proxy headers); no victim's connectors were invoked. Production D1 check recommended for maintainers: list deployed prompt agents whose `mcpServers` includes `composio`/`machines` beyond the official fleet, and audit the six hardcoded `pk_` keys in frontends (`apps/catgpt/ai.js:12`, `apps/websim/src/config.ts:3`, `apps/openclaw/src/script.js:1`, `apps/sirius-cybernetics-elevator-challenge/src/hooks/ui.ts:59`, `apps/ai-dungeon-master/src/hooks/useAuth.ts:5`) for `accountPermissions` — safe today only if issue 59's server-side fix holds.
