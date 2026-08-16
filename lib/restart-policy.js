export const RESTART_EXIT_CODE = 75;
export const SUPERVISED_ENV = "DSH_BALANCE_SUPERVISED";
export const SUPERVISOR_PID_ENV = "DSH_BALANCE_SUPERVISOR_PID";
export const MAX_CONSECUTIVE_CRASHES = 3;

export function normalizeHarnessArgv(argv, actualPort) {
  if (!Array.isArray(argv)) throw new TypeError("argv must be an array");
  if (!Number.isInteger(actualPort) || actualPort < 1 || actualPort > 65535) {
    throw new TypeError("actual port is invalid");
  }
  const next = [...argv];
  for (let index = 0; index < next.length; index += 1) {
    if (next[index] === "--port" && next[index + 1] === "0") {
      next[index + 1] = String(actualPort);
      index += 1;
    } else if (next[index] === "--port=0") {
      next[index] = `--port=${actualPort}`;
    }
  }
  return next;
}

export function nextSupervisorAction({ exitCode, crashCount }) {
  if (exitCode === RESTART_EXIT_CODE) {
    return { action: "restart", crashCount: 0, delayMs: 250 };
  }
  if (exitCode === 0) {
    return { action: "stop", crashCount: 0, delayMs: 0 };
  }
  const nextCount = Math.max(0, crashCount) + 1;
  if (nextCount >= MAX_CONSECUTIVE_CRASHES) {
    return { action: "stop", crashCount: nextCount, delayMs: 0 };
  }
  return {
    action: "restart",
    crashCount: nextCount,
    delayMs: nextCount * 1000
  };
}

function validStringArray(value) {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

export function assertLaunchConfig(config) {
  if (config === null || typeof config !== "object") throw new TypeError("launch config must be an object");
  if (typeof config.execPath !== "string" || config.execPath === "") throw new TypeError("launch config execPath is required");
  if (!validStringArray(config.execArgv)) throw new TypeError("launch config execArgv must be a string array");
  if (!validStringArray(config.argv) || config.argv.length === 0) throw new TypeError("launch config argv must be a non-empty string array");
  if (typeof config.cwd !== "string" || config.cwd === "") throw new TypeError("launch config cwd is required");
  if (typeof config.host !== "string" || config.host === "") throw new TypeError("launch config host is required");
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) throw new TypeError("launch config port is invalid");
  if (!Number.isInteger(config.waitForPid) || config.waitForPid < 1) throw new TypeError("launch config waitForPid is invalid");
  return config;
}

export function encodeLaunchConfig(config) {
  assertLaunchConfig(config);
  return Buffer.from(JSON.stringify(config), "utf8").toString("base64url");
}

export function decodeLaunchConfig(encoded) {
  if (typeof encoded !== "string" || encoded === "") throw new TypeError("encoded launch config is required");
  return assertLaunchConfig(JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")));
}
