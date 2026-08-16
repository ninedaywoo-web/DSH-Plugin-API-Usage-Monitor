import test from "node:test";
import assert from "node:assert/strict";

import { createSupervisorLaunch } from "../lib/launch-platform.js";

const base = {
  execPath: "C:\\Program Files\\nodejs\\node.exe",
  supervisorPath: "C:\\Users\\测试用户\\plugin\\supervisor.js",
  encodedConfig: "encoded-config",
  cwd: "C:\\Users\\测试用户\\workspace"
};

test("Windows launches one minimized supervisor console without shell-built paths", () => {
  const launch = createSupervisorLaunch({ ...base, platform: "win32" });

  assert.equal(launch.command, "cmd.exe");
  assert.deepEqual(launch.args, [
    "/d",
    "/c",
    "start",
    "\"\"",
    "/min",
    base.execPath,
    base.supervisorPath,
    base.encodedConfig
  ]);
  assert.equal(launch.output, "discard");
  assert.equal(launch.detached, true);
});

test("macOS launches the supervisor directly and persists output to a log", () => {
  const supervisorPath = "/Users/test/Library/Application Support/dsh/plugin/supervisor.js";
  const launch = createSupervisorLaunch({
    ...base,
    platform: "darwin",
    execPath: "/opt/homebrew/bin/node",
    supervisorPath,
    cwd: "/Users/test/project"
  });

  assert.equal(launch.command, "/opt/homebrew/bin/node");
  assert.deepEqual(launch.args, [supervisorPath, base.encodedConfig]);
  assert.equal(launch.output, "log");
  assert.equal(launch.detached, true);
});
