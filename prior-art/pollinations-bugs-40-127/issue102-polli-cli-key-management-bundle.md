# polli CLI key-management bundle: harness/MCP-install keys are minted with no budget and no expiry and are never revoked on off/remove (the issue-95 class, client side); the secret is passed as a process argument to claude/gemini/amp; `polli keys create` prints the raw sk_ to stdout while the shipped agent skill routes agents into key management — an injection-to-fresh-key exfil primitive; logout clears only the active environment's credential file

**Severity: low-medium overall (four client-side findings that compound issue 95's server-side minting); individual severities marked.**

**Found: 2026-10-25. Code-verified (all excerpts read in-tree; codex contrast confirms the safe pattern already exists in the same file).**

## 1. `polli harness <x> on` mints `polli-harness-<id>` keys with no `pollenBudget` and no `expiresIn` — and `off`/`mcp remove` never revoke them (low-medium; compounds issue 95)

```ts
// packages/polli-cli/src/harnesses/keys.ts:46-57
const created = await gen<{ key: string }>("/account/keys", {
    method: "POST",
    apiKey: accountKey,
    body: {
        name: `polli-harness-${harness.id}`,
        type: "secret",
        ...(harness.accountPermissions ? { accountPermissions: ... } : {}),
    },          // ← no pollenBudget, no expiresIn — same shape as issue 95
});
```

`polli harness <x> off` (`src/commands/harness.ts:36-46`) only restores local config; `polli mcp remove` (`src/commands/mcp.ts:80-100`) only strips config entries. The CLI's own comment documents the accumulation problem and fixes only the re-minting half: *"Reinstalls reuse the key … instead of minting another orphan: /account/keys accepts duplicate names, so always minting leaks dead secret keys onto the account"* (`mcp.ts:56-58`). Every on/off cycle therefore strands a live, **unbudgeted, never-expiring** `sk_` on the account, with copies persisted in third-party client configs (`~/.claude.json`, `~/.gemini/settings.json`, `~/.config/amp/settings.json`), in `~/.pollinations/harnesses/<id>.<hash>.json` **snapshots** (which store full pre-change file contents, including other providers' secrets), and in any backups the user made. The only deletion anywhere in the package is the manual `polli keys revoke` (`src/commands/keys.ts:297-313`), called by nothing. Fix: `off`/`remove` should revoke the key they minted (server-side: `createApiKeyForUser` could accept an expiry, mirroring the issue-95 fix).

## 2. The minted secret is passed as a **process argument** to claude-code/gemini/amp — readable from `/proc/<pid>/cmdline` on any multi-user host (medium)

```ts
// packages/polli-cli/src/mcp/clients.ts:672-683 (claude-code; gemini :758-768 and amp :801-807 identical)
addArgs: (server, key) => [
    "mcp", "add", "--scope", "user", "--transport", "http",
    server.id, server.url,
    "--header", `Authorization: Bearer ${key}`,   // ← sk_ in argv
],
```

Any local unprivileged user reads the fresh `sk_` from `ps auxww` / `/proc/<pid>/cmdline` during the install window. The adjacent **codex** adapter deliberately avoids exactly this (`clients.ts:706-748`: `--bearer-token-env-var POLLI_MCP_CODEX_API_KEY` + a 0600 env file), and Claude Code supports env-var headers too — the fix pattern is in the same file. The CLI's target environment (coding-harness sandboxes, CI runners, agent hosts) makes multi-user the common case, not the edge case. Fix: route all three adapters through env-var tokens or stdin like codex.

## 3. `polli keys create` prints the raw `sk_` to stdout while the shipped agent skill grants `Bash(polli *)` — converting any successful prompt injection into a fresh, unbudgeted account key (low; chains on the issue-93 injection class)

```ts
// packages/polli-cli/src/commands/keys.ts:235-239
printInfo("Save this key — it won't be shown again:\n");
process.stdout.write(`  ${created.key}\n\n`);
// JSON mode: printResult({ id, key: created.key, ... }) — also full key
```

`SKILL.md:1-5` gives agents `allowed-tools: Bash(polli *)`, and its Quick reference (§"Manage API keys") directs agents to `polli keys create/list/revoke`. The same file is careful about tokens from `auth login` (*"Tokens are stored locally and never included in that result"*, enforced by `auth.test.ts:107-119`) — but `keys create` has no `--quiet`, no file-sink, and no non-TTY/agent-mode guard. Chain: attacker content (repo README, issue body, fetched file — the issue-93 class) → injected agent runs `polli keys create` → the raw `sk_` lands in the agent's transcript → the agent exfiltrates it through any write primitive it has (including `polli upload`, which returns a public URL). Everything except the final write is inside `Bash(polli *)`. Fix: prompt before printing when stdout is not a TTY, or emit to `$POLLINATIONS_KEY_FILE`.

## 4. `polli auth logout` clears only the active environment's credential file while reporting success (low)

```ts
// packages/polli-cli/src/lib/config.ts:46-52
export const clearCredentials = () => {
    try { unlinkSync(CREDENTIALS_FILE); } catch {}   // credentials.json OR credentials.staging.json
};
```

`POLLINATIONS_ENV=staging polli auth login --with-token <real-prod-key>` writes `credentials.staging.json`; a later plain `polli auth logout` unlinks only `credentials.json` and prints **"Logged out. Credentials cleared."** — the staging file (often containing the user's *real* key, per SKILL.md's own guidance) survives indefinitely. Logout also never revokes the device-flow key server-side (acceptable given `polli keys revoke`, but nothing tells the user the "logged out" key is still live). Fix: clear both files (or list survivors), and mention revocation.

## Verified-clean (this audit; do not re-audit)

Credential-file hygiene (0700 dir, 0600 files, atomic 0600-forcing writes), auth-header discipline (Bearer everywhere, keys never in URLs — the direct contrast to issue 55), cross-user sandbox ssh **impossible** (`ownedSandbox` enforces owner metadata server-side; bootstrap.sh pins sshd with `PermitEmptyPasswords no`, 0600 authorized_keys, sha256-pinned websocat, `env -i` herdr), codex stdin key handoff, npm-signature-based self-update, no prototype pollution in config parsing, foreign-MCP-entry protection (`isOwnedEntry`), ssh proxy host regex, RFC-8187 filename headers on upload.

## Uncertain leads (for the record)

- `harness codex off` may leave `<state>/codex-router/generic-provider-credentials/pollinations.key` on disk (depends on the third-party router's `remove` behavior) — adds to finding 1's on-disk copies.
- Device-flow URL relay through the agent (SKILL.md:24 asks the agent to "show the user" the verification URL) enables a classic relay-phishing UX leg on top of the already-filed server-side issues 53/60/83.
- `~/.ssh/config` rewrite is a plain non-atomic `writeFileSync` (truncation-on-crash risk, not exploitable).
