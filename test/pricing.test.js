import test from "node:test";
import assert from "node:assert/strict";

import { priceAt } from "../lib/pricing.js";

test("the historical USD table matches DeepSeek's published chat and reasoner prices", () => {
  const time = Date.parse("2025-03-01T00:00:00+08:00");
  assert.deepEqual(priceAt("deepseek-chat", time).usd, {
    input: 0.27,
    cacheRead: 0.07,
    output: 1.1
  });
  assert.deepEqual(priceAt("deepseek-reasoner", time).usd, {
    input: 0.55,
    cacheRead: 0.14,
    output: 2.19
  });
});

test("a newer wildcard policy supersedes an older model-specific policy", () => {
  const policies = [
    {
      since: "2025-01-01T00:00:00Z",
      label: "old",
      prices: {
        legacy: {
          cny: { input: 10, cacheRead: 10, output: 10 },
          usd: { input: 10, cacheRead: 10, output: 10 }
        }
      }
    },
    {
      since: "2026-01-01T00:00:00Z",
      label: "new",
      prices: {
        "*": {
          cny: { input: 1, cacheRead: 1, output: 1 },
          usd: { input: 1, cacheRead: 1, output: 1 }
        }
      }
    }
  ];

  const result = priceAt("legacy", Date.parse("2026-02-01T00:00:00Z"), { policies });
  assert.equal(result.label, "new");
  assert.deepEqual(result.cny, { input: 1, cacheRead: 1, output: 1 });
});
