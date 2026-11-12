import { defineConfig } from "vitest/config";
import path from "node:path";

const UP = path.resolve(__dirname, "upstream/pollinations");

export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@shared\/(.*)$/,
        replacement: path.join(UP, "shared/$1"),
      },
      {
        find: /^@\/(.*)$/,
        replacement: path.join(UP, "gen.pollinations.ai/src/$1"),
      },
      {
        find: /^@enter\/(.*)$/,
        replacement: path.join(UP, "enter.pollinations.ai/src/$1"),
      },
      {
        find: /^@frontend\/(.*)$/,
        replacement: path.join(UP, "enter.pollinations.ai/frontend/src/$1"),
      },
      {
        find: "cloudflare:workers",
        replacement: path.resolve(__dirname, "harness/cloudflare-workers-stub.ts"),
      },
      {
        find: "cloudflare:email",
        replacement: path.resolve(__dirname, "harness/cloudflare-email-stub.ts"),
      },
    ],
  },
  test: {
    include: ["poc/**/*.test.ts"],
    environment: "node",
    testTimeout: 30000,
    hookTimeout: 30000,
    pool: "forks",
  },
});
