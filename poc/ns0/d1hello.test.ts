import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

describe("d1 harness", () => {
  it("can query the real migrated D1 schema", async () => {
    const tables = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' LIMIT 5",
    ).all<{ name: string }>();
    expect(Array.isArray(tables.results)).toBe(true);
    console.log("TABLES", JSON.stringify(tables.results));
  });
});
