import test from "node:test";
import assert from "node:assert/strict";

import {
  RESTART_EXIT_CODE,
  decodeLaunchConfig,
  encodeLaunchConfig,
  normalizeHarnessArgv,
  nextSupervisorAction
} from "../lib/restart-policy.js";

test("an explicit restart exit always relaunches and clears crash history", () => {
  assert.deepEqual(
    nextSupervisorAction({ exitCode: RESTART_EXIT_CODE, crashCount: 2 }),
    { action: "restart", crashCount: 0, delayMs: 250 }
  );
});

test("an ephemeral --port 0 launch is pinned to the actual listening port on restart", () => {
  assert.deepEqual(
    normalizeHarnessArgv(["/usr/local/lib/dsh/bin.js", "web", "--port", "0"], 43127),
    ["/usr/local/lib/dsh/bin.js", "web", "--port", "43127"]
  );
  assert.deepEqual(
    normalizeHarnessArgv(["/usr/local/lib/dsh/bin.js", "web", "--port=0"], 43127),
    ["/usr/local/lib/dsh/bin.js", "web", "--port=43127"]
  );
});

test("a normal exit stops the supervisor", () => {
  assert.deepEqual(
    nextSupervisorAction({ exitCode: 0, crashCount: 0 }),
    { action: "stop", crashCount: 0, delayMs: 0 }
  );
});

test("unexpected crashes restart twice, then stop instead of looping forever", () => {
  const first = nextSupervisorAction({ exitCode: 1, crashCount: 0 });
  const second = nextSupervisorAction({ exitCode: 1, crashCount: first.crashCount });
  const third = nextSupervisorAction({ exitCode: 1, crashCount: second.crashCount });

  assert.deepEqual(first, { action: "restart", crashCount: 1, delayMs: 1000 });
  assert.deepEqual(second, { action: "restart", crashCount: 2, delayMs: 2000 });
  assert.deepEqual(third, { action: "stop", crashCount: 3, delayMs: 0 });
});

test("launch configuration round-trips Windows paths and Unicode without shell quoting", () => {
  const config = {
    execPath: "C:\\Program Files\\nodejs\\node.exe",
    execArgv: ["--max-old-space-size=4096"],
    argv: ["C:\\Example\\DeepSeek\\入口.js", "web"],
    cwd: "C:\\Example\\DeepSeek",
    host: "127.0.0.1",
    port: 3080,
    waitForPid: 1234
  };

  assert.deepEqual(decodeLaunchConfig(encodeLaunchConfig(config)), config);
});
