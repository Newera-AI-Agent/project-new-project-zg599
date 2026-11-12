# The official Discord bots are a free, unlimited, unauthenticated generation faucet funded by one shared platform key: the six discord-bot-family bots always respond to mentions/DMs on paid models and hand out their own public install link (`!invite`), and catgpt-bot generates a paid-only 1024×1024 image plus a text completion per mention — no per-user cooldown, no Pollinations account, no pollen charge to the caller, anywhere

**Severity: medium-high (platform-funded provider spend with zero identity requirements — the "free unlimited generation" surface that survives the issue-104 verdict; bounded only by the shared `TEXT_POLLINATIONS_TOKEN` account's budget).**

**Found: 2026-10-25. Code-verified across all three bots (config, request paths, models, absence of any cooldown/charge). No mention-spamming was performed.**

## Summary

Issue 104 closed the "free unlimited video" question on the *official model path* — every video model is `paidOnly` and usage enforcement is load-bearing. **The Discord surface has the opposite posture**: three official bot deployments answer unauthenticated mentions with real paid-model generations, charged to one shared platform-side key, with no per-user economics of any kind.

### 1. discord-bot-family — six bots, mention/DM always-respond, public self-install

`apps/discord-bot-family/src-functional/bot-loop.ts:356-358` — the rate-limit comment says it itself:

```ts
// Human mentions and DMs: always respond
```

The only throttling is channel-level and only for *undirected* messages in global channels (5 bot messages/min per channel, `bot-loop.ts:328-343`); a directed mention or DM **always** produces a completion. The completion goes through `src-functional/api.ts:18` — *"No rate limiting needed - let the API handle concurrent requests"* — as:

```ts
axios.post(url, requestData, { headers: {
    "Referer": "roblox",
    "Authorization": `Bearer ${process.env.TEXT_POLLINATIONS_TOKEN}`,
}})
```

`bots.json` runs six bots on `kimi`, `gemini-search` (`paidOnly: true`, `shared/registry/text.ts:1522`), `perplexity-fast`, `nova-fast`, `deepseek`, `minimax` — every bill lands on the shared platform account. And the surface is **self-serve**: `!invite` (`bot-loop.ts:305-312`) replies with the bot's public OAuth install URL (`https://discord.com/api/oauth2/authorize?client_id=…&permissions=274877908032&scope=bot`), so any Discord user can add a bot to their own server and mention it in a loop.

### 2. catgpt-bot — one mention = one text completion + one paid-only image + one media upload

`apps/catgpt-bot/bot.ts`:

- `:15-19` — `API_KEY = process.env.TEXT_POLLINATIONS_TOKEN`, `TEXT_API = …/v1/chat/completions`, `IMAGE_API = …/image`, `AUTH = { Authorization: Bearer … }`.
- `:137-140` (messageCreate handler): only gates are `author.bot`, a per-message-id dedup set, and mention presence — **no user cooldown, no quota, no charge**.
- `:159-171` — per mention: `generateCatReply` (text completion) → `fetchImage(buildImageUrl(...))` where `buildImageUrl` (`:86-88`) requests `model=${MODEL}` with `MODEL = "nanobanana-2-lite"` (`:26`) — that alias resolves to **`google/gemini-3.1-flash-lite-image`, `paidOnly: true`** (`shared/registry/image.ts`) — at `height=1024&width=1024`.
- `:171-176` — the image is additionally **published to `media.pollinations.ai`** (media upload per mention).
- `:204-238` — `catchUpUnanswered` re-processes up to 5 unanswered messages **on every boot**, so bot restarts re-trigger paid generations.
- Issue 57/100 already covered this bot's *key-in-URL logging* — **who pays per mention was never filed**.

### 3. opposite-prompt-bot — the same shape

`apps/opposite-prompt-bot/bot.ts:14-18` — same `TEXT_POLLINATIONS_TOKEN`, same `TEXT_API` + `IMAGE_API` pair, same mention-driven flow.

## The attack (which is also just… normal usage that doesn't get billed)

1. Discord account (free, no Pollinations identity, no pollen, no API key).
2. `!invite` any family bot into a private server (or DM it), or mention catgpt-bot where it lives.
3. Loop `@bot <anything>` at Discord's own message-rate ceiling (~5 msgs/5 s/channel, plus other channels/servers in parallel).
4. Every message yields a paid-model completion (catgpt: + a `paidOnly` 1024² image + a media upload). Aggregate cost scales linearly with mentions; the only ceiling in the entire chain is the shared token's budget on the platform account.

This is simultaneously (a) the **free unlimited generation** answer on the bot surface — the caller extracts unlimited paid-model output — and (b) the **cheapest financial-bleed / DoS surface on the platform** (weaker than issue 69: no account, no upload, no HTML parse — one Discord message per generation), per the DDoS surface-mapping the team asked for.

## Why this is not a duplicate

- **Issue 57 / issue 100 §5** covered catgpt-bot's *key logging* (key-in-URL), not the funding loop or the other bots.
- **Issue 85** (realtime) required a Pollinations account and key; this surface requires neither.
- **Issue 94 §1** (Bedrock guardrails unbilled) is the gen middleware; this is the bot fleet.
- The family bot's `api.ts:18` "no rate limiting" comment was quoted in an internal audit note but never filed as an issue.

## Fix (minimal)

1. Per-Discord-user cooldown + daily cap in the bot loop (e.g. 20 gens/user/day), and/or per-guild caps.
2. Move the bots onto a key with a **pollenBudget** sized for the service, so bleed is bounded by construction and visible in billing.
3. Prefer tier-fundable/free models for mention responses, or bill the guild owner's linked account when one exists.
4. Remove `catchUpUnanswered`'s paid re-generation on boot (or mark messages answered at generation time, not at reply time).

## Verification note

All static. A safe live check (one generation, no spam): mention catgpt-bot once, confirm a comic image arrives, then confirm in the platform billing that the charge landed on the shared token's account rather than any caller — that single data point proves the funding attribution without any load.
