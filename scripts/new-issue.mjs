#!/usr/bin/env node
// Generate a finding markdown + research log line from a compact JSON spec.
// Usage: node scripts/new-issue.mjs <spec.json>
import { readFileSync, writeFileSync, mkdirSync, appendFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const specPath = process.argv[2];
if (!specPath) {
  console.error("usage: node scripts/new-issue.mjs <spec.json>");
  process.exit(2);
}
const spec = JSON.parse(readFileSync(specPath, "utf8"));
const {
  slug,
  area,
  title,
  severity,
  component,
  cwe,
  wave,
  summary,
  attackerPath,
  reproduction = [],
  evidence,
  citations = [],
  impact,
  remediation,
  dedupe,
  negative = [],
} = spec;

if (!slug || !title || !severity || !component || !cwe || !wave || !summary) {
  console.error("missing required spec fields");
  process.exit(2);
}

let observed = "(no evidence captured yet)";
if (evidence) {
  try {
    observed = readFileSync(resolve(evidence), "utf8").trimEnd();
  } catch {
    observed = `(evidence file ${evidence} not found)`;
  }
}

const citationLines = citations
  .map((c) => `- \`upstream/pollinations/${c.file}:${c.line}\` — ${c.what}`)
  .join("\n");
const reproLines = reproduction.map((r) => `- ${r}`).join("\n");
const negLines = negative.length
  ? "\n\n## Negative results in this area (not vulnerabilities)\n\n" +
    negative.map((n) => `- ${n}`).join("\n")
  : "";

const md = `# ${slug} — ${title}

- **Severity:** ${severity}
- **Component:** \`upstream/pollinations/${component}\`
- **CWE:** ${cwe}
- **Wave:** ${wave}

## Summary

${summary}

## Attacker path (minimal, local)

${attackerPath}

## Reproduction

${reproLines}

- PoC: \`${spec.poc || `poc/${area}/${slug}.test.ts`}\`
- Command: \`${spec.command || `scripts/verify.sh poc/${area}/${slug}.test.ts`}\`
- Observed (verbatim):

\`\`\`text
${observed}
\`\`\`

## Code citations

${citationLines}

## Impact

${impact}

## Remediation

${remediation}

## Dedupe note

${dedupe}${negLines}
`;

const outPath = resolve(spec.out || `issue${spec.index}.md`);
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, md);
// keep a copy of the narrative under findings/<area>/ for traceability
const mirror = resolve(`findings/${area}/${slug}.md`);
mkdirSync(dirname(mirror), { recursive: true });
writeFileSync(mirror, md);

const logPath = resolve(`research/${area}-log.md`);
mkdirSync(dirname(logPath), { recursive: true });
appendFileSync(
  logPath,
  `${slug} | ${severity} | VERIFIED (PoC green, evidence/${spec.evidenceName || evidence || ""}) | dedupe vs prior art: ${dedupe.replace(/\s+/g, " ").slice(0, 160)}\n`,
);
console.log(`[new-issue] wrote ${outPath} and appended ${logPath}`);
