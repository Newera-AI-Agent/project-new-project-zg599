import { describe, expect, it } from "vitest";
import dns from "node:dns/promises";
import { validateUserMediaUrl } from "@shared/user-media-url.ts";

// Proof that the SSRF filter in shared/user-media-url.ts is bypassable with a
// trailing-dot FQDN. "localhost." is a legal FQDN form of "localhost" and
// resolves to the loopback interface, but the regex /^localhost$/i never
// matches it because of the trailing dot.
async function resolves(hostname: string): Promise<string[]> {
  const records = await dns.lookup(hostname, { all: true });
  return records.map((r) => r.address);
}

describe("VULNERABLE: validateUserMediaUrl accepts loopback via trailing-dot FQDN", () => {
  it("http://localhost./x.png is ALLOWED and resolves to loopback", async () => {
    const value = "http://localhost./x.png";
    const result = validateUserMediaUrl(value);
    const addresses = await resolves("localhost.");
    console.log(
      `[VULN] validateUserMediaUrl(${value}) -> ok=${result.ok} reason=${result.ok ? "-" : result.reason} dns(localhost.)=${addresses.join(",")}`,
    );
    expect(result.ok).toBe(true); // filter fails to block
    expect(addresses.some((a) => a === "127.0.0.1" || a === "::1")).toBe(true);
  });
});

describe("NEGATIVE CONTROLS (not vulnerabilities, filter behaves correctly)", () => {
  const blocked = [
    "http://localhost/x.png",
    "http://127.0.0.1/x.png",
    "http://[::1]/x.png",
    "http://2130706433/x.png", // WHATWG URL normalises to 127.0.0.1
    "http://0x7f000001/x.png", // WHATWG URL normalises to 127.0.0.1
    "http://127.1/x.png", // WHATWG URL normalises to 127.0.0.1
    "http://10.0.0.1/x.png",
    "http://169.254.169.254/x.png",
  ];
  for (const value of blocked) {
    it(`blocks ${value}`, () => {
      const result = validateUserMediaUrl(value);
      console.log(
        `[CONTROL] validateUserMediaUrl(${value}) -> ok=${result.ok} reason=${result.ok ? "-" : result.reason}`,
      );
      expect(result.ok).toBe(false);
    });
  }
});
