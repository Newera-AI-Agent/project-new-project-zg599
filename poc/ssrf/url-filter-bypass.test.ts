import { describe, expect, it } from "vitest";
import dns from "node:dns/promises";
import { validateUserMediaUrl } from "@shared/user-media-url.ts";

// DEFECT (VULNERABLE upstream): shared/user-media-url.ts blocks the literal
// host "localhost" with /^localhost$/i, but the WHATWG URL parser keeps the
// trailing dot of a FQDN, so "localhost." survives the regex and resolves to
// 127.0.0.1 via the resolver. The filter therefore ALLOWS a loopback target.
describe("SSRF blocklist bypass - shared/user-media-url.ts (VULNERABLE upstream)", () => {
  it("filter ACCEPTS trailing-dot loopback FQDN http://localhost./a.png", async () => {
    const value = "http://localhost./a.png";
    const result = validateUserMediaUrl(value);
    const host = new URL(value).hostname;
    const addresses = (await dns.lookup(host, { all: true })).map((r) => r.address);
    console.log(
      `[user-media-url] ${value} -> allowed=${result.ok} reason=${result.ok ? "-" : result.reason} host=${host} resolves=${addresses.join(",")}`,
    );
    // The defect: the SSRF filter ALLOWS a host that resolves to loopback.
    expect(result.ok).toBe(true);
    expect(host).toBe("localhost.");
    expect(addresses).toContain("127.0.0.1");
  });
});

// NEGATIVE CONTROL: the same filter correctly refuses every other loopback
// encoding, proving the trailing-dot case is a specific gap, not a misreading.
describe("NEGATIVE CONTROL - other loopback encodings are refused", () => {
  const refused = [
    "http://localhost/a.png",
    "http://2130706433/a.png",
    "http://0x7f000001/a.png",
    "http://127.1/a.png",
    "http://127.0.0.1/a.png",
    "http://127.0.0.1./a.png",
    "http://10.0.0.1/a.png",
    "http://169.254.169.254/a.png",
    "http://[::1]/a.png",
    "http://sub.localhost/a.png",
  ];
  for (const value of refused) {
    it(`filter REFUSES ${value}`, () => {
      const result = validateUserMediaUrl(value);
      console.log(
        `[user-media-url] ${value} -> allowed=${result.ok} reason=${result.ok ? "-" : result.reason}`,
      );
      expect(result.ok).toBe(false);
    });
  }
});
