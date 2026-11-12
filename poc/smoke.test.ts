// Smoke test: proves the PoC harness executes REAL upstream pollinations code.
import { describe, expect, it } from "vitest";
import {
  redirectUriMatchesAllowlist,
  redirectUriMatchesAllowlistExact,
  parseAuthorizeRedirectUrl,
} from "@shared/auth/redirect-uri.ts";
import {
  getRealClientIp,
  truncateIpToSubnet,
  stripIPv4MappedPrefix,
} from "@shared/client-ip.ts";

describe("harness smoke", () => {
  it("loads upstream redirect-uri module", () => {
    expect(typeof redirectUriMatchesAllowlist).toBe("function");
    expect(
      redirectUriMatchesAllowlist(
        "https://app.example.com/cb",
        ["https://app.example.com/cb"],
      ),
    ).toBe(true);
  });
  it("loads upstream client-ip module", () => {
    expect(stripIPv4MappedPrefix("::ffff:1.2.3.4")).toBe("1.2.3.4");
    expect(truncateIpToSubnet("1.2.3.4")).toBe("1.2.3.0");
  });
  it("exposes exact matcher and browser-scheme guard", () => {
    expect(typeof redirectUriMatchesAllowlistExact).toBe("function");
    expect(parseAuthorizeRedirectUrl("javascript:alert(1)")).toBeNull();
  });
});
