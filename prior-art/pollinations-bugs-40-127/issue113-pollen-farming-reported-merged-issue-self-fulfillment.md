# Pollen farming II — `reported_merged_issue` pays 3 tier pollen per issue closed by a merged PR, with no check that the closing PR's author differs from the issue author: file N small issues yourself, submit the one-line PRs yourself, and each maintainer merge pays you 3 pollen as the reporter on top of the PR's own quest rewards

**Severity: medium (repeatable per-issue mint gated only by maintainer willingness to merge small PRs; a pressure/attention-farming vector against the repo's own merge culture — the auto-fix bot exists precisely because small fixes flow).**

**Found: 2026-10-25. Code-verified (quest definition → proposal query → exclusions → reward key). No issues or PRs were filed as part of this verification.**

## Summary

`enter.pollinations.ai/src/services/quests/groups/github-contributions.ts:87-96`:

```ts
const reportedIssueQuest: QuestDefinition = {
    id: "reported_merged_issue",
    title: "Report an issue that gets fixed",
    description: `[Report a bug or suggest an improvement](https://github.com/${REPO}/issues/new/choose) in the Pollinations repository. Earn 3 Quest Pollen for each issue closed by a merged PR. App submissions do not count.`,
    scope: "perUser",
    rewardAmount: 3,
    balanceBucket: "tier",
    ...
};
```

The proposal path (`:458-500`) pays the **issue author** whenever any merged PR closed the issue (author `databaseId === user.githubId` is verified). The only exclusions (`:25-33`) are label/title based:

```ts
const ISSUE_REPORT_EXCLUDED_LABELS = new Set(["DRAFT-QUEST", "APP-SUBMISSION", "AUTOMATED"]);
const ISSUE_REPORT_EXCLUDED_TITLE = /\[(?:App|Project) Submission\]|^\[Community(?: Model)? Publisher Access\]/i;
```

**There is no check that the closing PR's author ≠ the issue author** — even though the data is already fetched (`closedByPullRequestsReferences` returns PR authors). The reward key `quest:github:reported_issue:<issueN>:github:<id>` (`:486-492`) is **per-issue**, so N distinct issues = N×3 pollen, unbounded over time.

## Attack chain

1. File a stream of small-but-plausible issues in `pollinations/pollinations` (docs typos, broken links, minor inconsistencies — the repo's issue #6418 seed-tracking exception and the auto-fix bot show how routine small fixes are).
2. Submit matching one-line PRs starting `Fixes #N` from the **same GitHub account**.
3. Each merge closes the issue → 3 pollen as the reporter, **plus** the first PR also pays `merged_pr` (5, once), plus any attachable POLLEN-QUEST bounty (issue 82's misrouting surface) on the same pair.
4. Repeat — the multiplier is maintainer attention, not code.

Every merged pair also feeds the standings/leaderboard aggregates (pollution), and the issue/PR stream itself degrades the triage surface the maintainers depend on (compounding issue 93's automation consumption of issue bodies).

## Why this is not a duplicate

- **Issue 82** covers the *Quest-field* misrouting on **app submissions** and quest-amount parsing on POLLEN-QUEST issues; its companion notes cover `hasMergedPr` username trust and the >10,000 reward DoS. The reporter==author loop on `reported_merged_issue` is a different quest with a different payout key — unfiled until now.

## Fix (minimal)

1. Exclude same-author pairs: `closedByPullRequestsReferences` already carries PR authors — skip proposals where the closing PR's author `databaseId` equals the issue author's.
2. Require triage survival: exclude `AUTOMATED`-labeled or bot-closed issues (partially covered by labels), and consider a `triage/accepted` label gate.
3. Optionally cap `reported_merged_issue` payouts per user per time window (e.g. 5/week) — the per-issue key makes it otherwise unbounded.
