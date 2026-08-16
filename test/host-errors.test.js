import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../lib/index.js", import.meta.url), "utf8");

test("the no-key response still identifies the running Harness instance", () => {
  const start = source.indexOf('error: "no-api-key"');
  const end = source.indexOf("return;", start);
  assert.ok(start >= 0 && end > start);
  assert.match(source.slice(start, end), /instanceId/);
});
