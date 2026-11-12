# issue 82 — app-approval bounty misrouting: the free-text `Quest` field on any app submission closes and pays out ANY open POLLEN-QUEST issue when a maintainer approves the app (no quest-type, fulfillment, or linkage check anywhere in the chain); plus quest reward amounts are user-supplied/editable issue text capped only at 10,000 Pollen

**Severity: medium-high (integrity of the bounty economy — one-click confused-deputy payout + permanent quest consumption + standings pollution; every gate in the chain validates the app, none validate the bounty routing)**
**Status: LIVE-VERIFIED end-to-end (2026-10-25): the mechanism is proven in production by merged bot PR #17642; all 5 currently-open quests are attachable; code-verified every hop in the tree**

## Summary

Approving an app for the community catalog is a judgment about **one resource**: "this app is good enough to be listed." But the publish pipeline turns that single label into three unrelated actions, one of which pays money:

1. `APP-APPROVED` label (maintainer, one click on the app issue)
2. → bot branch `auto/app-<issue>-<run>` + commit with **`Fixes #<app-issue>, fixes #<quest>`** where `<quest>` is a **free-text field the submitter filled in on their own form**
3. → catalog PR auto-merges (`gh pr merge --auto --squash`) → **both issues close**
4. → enter's quest checker sees the quest closed by a bot `auto/app-` PR and pays the **full quest reward to the app submitter** (commit co-author), permanently (idempotency key is forever)

The only validation the quest linkage ever receives across the entire chain is in `operations/app-management/ingestion/validate-submission.js:134-138`:

```js
if (/^\d+$/.test(submission.quest) && !isOpenQuest(submission.quest)) {
    errors.push(
        `Quest #${submission.quest} is not an open POLLEN-QUEST issue. Enter an open quest or leave the Quest field empty.`,
    );
}
```

`isOpenQuest` (same file, lines 19-40) checks exactly two things: the issue is `OPEN` and carries the `POLLEN-QUEST` label. It does **not** check:

- that the quest is app-completable at all (code quests like #17256 "async media requests, 20 Pollen" were equally attachable while open — the quest template's own instructions describe "code quests" and "app submission quests" as different kinds, but the data model has no type),
- that this app fulfills the quest's goal/scope/acceptance criteria,
- that the submitter is anyone the quest was intended for (no assignment — though quests are intentionally multi-winner, that design is for PRs that demonstrably do the work),
- or that a maintainer has ever looked at the linkage.

### The approver never sees the bounty they are routing

The maintainer's checklist is written by the bot itself. The AI pre-review agent (`operations/app-management/ingestion/review-agent.py`) has **zero quest logic** — `rg quest` on the file matches nothing but `import requests` — and its "ready" comment tells the maintainer exactly what to verify:

```python
body = (
    f"{COMMENT_MARKER}\n## App pre-review: ready for human review\n\n{mention}{summary}\n\n"
    "A maintainer can verify the app, confirm the badge or pollinations.ai link is visible, and add `APP-APPROVED` to publish it."
)
```

Verify the app. Confirm the badge. `APP-APPROVED`. The word "quest" appears nowhere in the approval checklist, so the payout routing travels through the approval as a stowaway. The catalog PR is authored by the bot, and its squash body carries the closing keywords — reviewers of a routine "+1 line to app.json + README" diff are reviewing the app listing, not re-adjudicating a bounty.

### The payment hop (enter side)

`enter.pollinations.ai/src/services/quests/groups/github-contributions.ts` resolves quest payees from the closing PR graph:

```ts
// :381-385 — who earns a quest closed by an app-publish PR?
completedByGithubIds: closers.flatMap((pr) =>
    isAppPublishPr(pr)
        ? (appPublishPayees.get(pr.number) ?? [])   // commit co-authors = submitter
        : githubIds([pr.author]),
),
```

```ts
// :334-340 — the bot-PR pattern match
function isAppPublishPr(pr: ClosingPullRequest): boolean {
    return (
        pr.author?.__typename === "Bot" &&
        pr.author.login === APP_PUBLISH_BOT &&
        APP_PUBLISH_BRANCH.test(pr.headRefName)   // /^auto\/app-\d+-/
    );
}
```

and `evaluateUser` pays when `issue.completedByGithubIds.includes(githubId) && (issue.rewardAmount ?? 0) > 0`. The submitter's GitHub account (linked to their Pollinations identity) then claims the reward on enter — the comment in the publish workflow says it outright: *"A named quest closes with the submission, paying the submitter."*

## Live verification (all read-only, 2026-10-25)

1. **The mechanism is in production**: merged bot PR **#17642** ("Add Pollinations for MIT App Inventor to build" by `pollinations-ai[bot]`) carries body refs `Fixes #17293, fixes #17247` — app issue #17293 and quest #17247 (the 7-Pollen MIT App Inventor quest). That submitter earned the quest through the app-approval path exactly as designed. The same machinery accepts any quest number.
2. **Currently attachable bounties** (open POLLEN-QUEST issues, all reachable from the public form `?template=quest.yml`): #18367 (7), #17999 (12), #17998 (10), #17689 (10), #16856 (5) — 44 Pollen in total today, one app approval each.
3. **Multi-winner quests concentrate the exposure**: #17689 ("Build an MCP server…", 10 Pollen) already has **64 PRs** referencing it — each merged author legitimately earns 10 Pollen. It is a pure code quest, yet `isOpenQuest` would accept it as a `quest` field on any app submission.
4. **Code quests are historically attachable**: #17256 (async media requests, 20 Pollen — a code quest) was open for months and only happened to be closed by code PRs; nothing in the chain would have rejected an app submission linking it.
5. **Scale of the pipeline**: 1,059 merged `auto/app-` PRs to date — the submitter-facing form is the platform's main intake, so the `quest` field is a permanent, user-controlled feature, not a corner case.

## Attack (self-contained, no special access)

1. Attacker builds any badge-crediting, Pollinations-calling app that clears the (legitimate) catalog quality bar — the bar attests the app is real, not that it did any quest's work.
2. On the submit form (`.github/ISSUE_TEMPLATE/app-submission.yml`), fill the optional `Quest` input with any open quest number, e.g. `#17999` (12 Pollen) or multi-winner `#17689` (10 Pollen).
3. Pass AI pre-review (app reachable, badge present) and maintainer review (bot checklist: verify app + badge). Maintainer adds `APP-APPROVED`.
4. Automation takes over: revalidate → `auto/app-<n>-<run>` branch → commit `Fixes #<app>, fixes #<quest>` with attacker as `Co-authored-by` → catalog PR auto-merge → **quest issue closes**.
5. On enter.pollinations.ai the attacker runs quest check: the closed-with-merged-closers quest (filter: `issue.state === "OPEN" || mergedClosers(issue).length > 0`, github-contributions.ts:407-410) resolves payees from the bot PR's commit authors → attacker's linked GitHub id is in `completedByGithubIds` → reward recorded, claimable forever.
6. Repeat per open quest (one app each). Damage per quest: (a) unearned bounty credited, (b) the quest is removed from the open board for its intended audience (denial of the bounty to legit solvers while it stays closed), (c) the monthly standings race (`quest-leaderboard.ts` includes github contribution quests in `buildQuestStandings`) is polluted.

## The amount-integrity companion (same bounty system, same trust posture)

The reward amount itself is user-supplied issue text, parsed at payout time with no per-quest cap below the global `MAX_REWARD_AMOUNT = 10_000` (`shared/billing/rewards.ts:7`):

```ts
// github-contributions.ts:39 — amount comes from the issue body
const QUEST_REWARD_REGEX = /###\s*Reward\s*\n+\s*([0-9]+(?:\.[0-9]+)?)/i;
```

- The Community Quest template's `Reward` input (`quest.yml`, `id: reward`) is filled by whoever opens the issue; the `### Reward` heading the regex parses is rendered from that input.
- The template asks maintainers to rewrite community proposals ("Only maintainer-authored quest issues should receive the `POLLEN-QUEST` label… a maintainer should create the final quest issue before labeling it") — but that is prose guidance, not a check. Nothing verifies issue authorship, and GitHub lets issue authors edit their own bodies at any time, including after labeling.
- If a labeled quest body ever says `### Reward` + 51…10,000, the checker records it verbatim (`assertRewardAmount` only rejects > 10,000); a body claiming more than 10,000 instead throws inside the group and silently kills that user's whole github-contributions evaluation (minor DoS, caught by `evaluateGroup`).
- All current open quests are 5-12 Pollen, so a hyper-inflated body would stand out to a careful labeler — but a "50" or "100" would not, and the app-approval path above never re-derives the amount from anywhere authoritative at payout time.

Minor sibling note (same file): `hasMergedPr` (github-contributions.ts:502-512) trusts the `author:<username>` search without re-checking `databaseId` on the returned PR — unlike `reportedIssueProposals` and `answeredSurvey`, which both verify. A stale `githubUsername` (username recycling between syncs) could earn the 5-Pollen `merged_pr` quest on someone else's merged PR. Low value, listed for completeness.

## Fix (minimal)

1. **Make quest linkage an explicit maintainer decision, not stowaway routing**: the pre-review "ready" comment and the catalog PR body must state "⚠️ This approval will close quest #N and pay <submitter> its reward" and, ideally, require a second label (e.g. `QUEST-CONFIRMED` on the app issue, or a checkbox on the catalog PR) before the workflow includes `fixes #<quest>` in the commit.
2. **Type-check the target**: `isOpenQuest` should additionally require the quest to be app-completable (e.g. an `APP-QUEST` label applied by the quest template for app quests) — code quests must be closed only by code PRs.
3. **Bound the amount server-side**: keep a maintained bounty table (issue number → sanctioned amount) or cap quest rewards parsed from bodies (e.g. ≤ 50) with a distinct error, so user-editable text can never set a payout above what a maintainer sanctioned; verify the quest issue author is an org member when labeling is the only gate.
4. Copy `hasMergedPr`'s identity check from its siblings (`author.databaseId === user.githubId`).

## Notes for the reviewer

- The intended flow (an app built FOR a quest, approved, paid) is legitimate and in production — the finding is that the linkage is **unvalidated submitter input that routes money**, invisible at the exact moment a human authorizes it.
- The maintainer gate is real and not bypassed; this is a confused-deputy/insufficient-authorization-check finding: the approval's meaning ("catalog-worthy app") is silently amplified into a second, unrelated authorization ("this app completed bounty #N").
- No live bounty was actually misrouted by me; all live checks were read-only (public API/HTML reads of open quests, merged PRs #17642/#18385, and the search index).
