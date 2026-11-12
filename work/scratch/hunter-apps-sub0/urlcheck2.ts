import { validateUserMediaUrl } from "/home/runner/work/project-new-project-zg599/project-new-project-zg599/upstream/pollinations/shared/user-media-url.ts";
const cases = [
 "http://127.0.0.1./",
 "http://169.254.169.254./",
 "http://10.0.0.1./",
 "http://[::1]./",
 "http://localhost./",
 "http://127.0.0.1%2e/",
 "http://127。0。0。1/",
 "http://127.0.0.1./x",
];
for (const c of cases) {
  let u: string;
  try { u = new URL(c).hostname; } catch { u = "(invalid)"; }
  const r = validateUserMediaUrl(c);
  console.log(c, "| hostname=", u, "=>", r.ok ? "ALLOWED " + r.url.href : r.reason);
}
