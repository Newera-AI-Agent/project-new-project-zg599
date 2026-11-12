import { validateUserMediaUrl } from "/home/runner/work/project-new-project-zg599/project-new-project-zg599/upstream/pollinations/shared/user-media-url.ts";
const cases = [
 "http://127.0.0.1/",
 "http://[::1]/",
 "http://2130706433/",
 "http://0x7f000001/",
 "http://0177.0.0.1/",
 "http://user:pass@example.com/",
 "http://example.com@127.0.0.1/",
 "http://localhost./",
 "http://127.1/",
 "http://10.0.0.1.nip.io/",
 "http://169.254.169.254/",
 "file:///etc/passwd",
 "http://example.com\\@127.0.0.1/",
];
for (const c of cases) {
  const r = validateUserMediaUrl(c);
  console.log(c, "=>", r.ok ? r.url.href : r.reason);
}
