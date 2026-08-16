import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../lib/client.js", import.meta.url), "utf8");

test("the flask menu is force-hidden until the flask is clicked", () => {
  assert.match(
    source,
    /-flask-menu\]\[hidden\][^\n]*display\s*:\s*none\s*!important/,
    "the inline flex layout must not override the menu's initial hidden state"
  );
});

test("restart waits for a different Harness instance instead of any HTTP 200", () => {
  assert.match(source, /data\.instanceId\s*!==\s*previousInstanceId/);
  assert.doesNotMatch(
    source,
    /if \(res\.status === 200\) \{\s*try \{\s*window\.location\.reload/,
    "an HTTP 200 from the old process is not proof that restart completed"
  );
});

test("restart can reconnect before an API key has been configured", () => {
  const probeStart = source.indexOf("const probeNewInstance");
  const probeEnd = source.indexOf("const onRestart", probeStart);
  const probeSource = source.slice(probeStart, probeEnd);

  assert.match(probeSource, /typeof data\.instanceId === "string"/);
  assert.doesNotMatch(
    probeSource,
    /data\.ok === true/,
    "a valid new instance id is sufficient even when the balance call reports no API key"
  );

  const updateStart = source.indexOf("const update =");
  const errorBranch = source.indexOf("data.ok !== true", updateStart);
  const rememberInstance = source.indexOf("lastInstanceId = data.instanceId", updateStart);
  assert.ok(rememberInstance > updateStart && rememberInstance < errorBranch);
});

test("hot unload clears transient UI timers and fallback dragging clears bottom anchoring", () => {
  const cleanup = source.slice(source.indexOf("return () => {"), source.indexOf("function apply(ctx)"));
  assert.match(cleanup, /clearTimeout\(hoverTimer\)/);
  assert.match(cleanup, /clearTimeout\(tipTimer\)/);

  const moveStart = source.indexOf("const moveTo =");
  const moveEnd = source.indexOf("};", moveStart);
  assert.match(source.slice(moveStart, moveEnd), /style\.bottom\s*=\s*""/);
});

test("double-clicking home preserves the positioning context for the status card", () => {
  const homeStart = source.indexOf("const goHome =");
  const homeEnd = source.indexOf("};", homeStart);
  const homeSource = source.slice(homeStart, homeEnd);

  assert.match(
    homeSource,
    /bar\.style\.position\s*=\s*"relative"/,
    "the absolute status card needs the restored bar to remain its positioning context"
  );
});
