import { spawn } from "node:child_process";
import { createConnection } from "node:net";

import {
  RESTART_EXIT_CODE,
  SUPERVISED_ENV,
  SUPERVISOR_PID_ENV,
  decodeLaunchConfig,
  nextSupervisorAction
} from "./restart-policy.js";

const PORT_WAIT_MS = 30000;
const STABLE_RUN_MS = 60000;

function log(message) {
  const stamp = new Date().toLocaleString("zh-CN", { hour12: false });
  process.stdout.write(`[${stamp}] ${message}\n`);
}

function sleep(ms, unref = false) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    if (unref && typeof timer.unref === "function") timer.unref();
  });
}

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForPidExit(pid, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!pidAlive(pid)) return true;
    await sleep(100);
  }
  return !pidAlive(pid);
}

function portOpen(host, port) {
  return new Promise((resolve) => {
    const socket = createConnection({ host, port });
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(250, () => finish(false));
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}

async function waitForPort(host, port, expectedOpen, timeoutMs = PORT_WAIT_MS) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await portOpen(host, port) === expectedOpen) return true;
    await sleep(150);
  }
  return (await portOpen(host, port)) === expectedOpen;
}

function spawnHarness(config) {
  const child = spawn(config.execPath, [...config.execArgv, ...config.argv], {
    cwd: config.cwd,
    env: {
      ...process.env,
      [SUPERVISED_ENV]: "1",
      [SUPERVISOR_PID_ENV]: String(process.pid)
    },
    stdio: ["inherit", "inherit", "inherit", "ipc"],
    windowsHide: false
  });
  const state = { restartRequested: false };
  child.on("message", (message) => {
    if (message !== null && typeof message === "object" && message.type === "dsh-balance-restart") {
      state.restartRequested = true;
      log("已收到网页端重启请求，等待 Harness 完成清理。");
    }
  });
  const exit = new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    child.once("error", (error) => finish({ code: 1, signal: null, error }));
    child.once("exit", (code, signal) => finish({ code: code ?? 1, signal, error: null }));
  });
  return { child, exit, state };
}

async function main() {
  const config = decodeLaunchConfig(process.argv[2]);
  process.title = "DeepSeek Harness Supervisor";
  log(`监督器已启动，PID ${process.pid}，管理端口 ${config.port}`);

  if (!await waitForPidExit(config.waitForPid, PORT_WAIT_MS)) {
    log(`旧进程 ${config.waitForPid} 未按时退出，停止启动以避免重复进程。`);
    process.exitCode = 1;
    return;
  }
  if (!await waitForPort(config.host, config.port, false)) {
    log(`端口 ${config.port} 一直被占用，停止启动以避免抢占端口。`);
    process.exitCode = 1;
    return;
  }

  let stopping = false;
  let currentChild = null;
  let crashCount = 0;
  const stop = (signal) => {
    if (stopping) return;
    stopping = true;
    log(`收到 ${signal}，正在关闭 Harness。`);
    try {
      currentChild?.kill("SIGTERM");
    } catch {}
  };
  process.on("SIGINT", () => stop("SIGINT"));
  process.on("SIGTERM", () => stop("SIGTERM"));

  while (!stopping) {
    if (!await waitForPort(config.host, config.port, false)) {
      log(`端口 ${config.port} 未释放，停止以避免启动多个 Harness。`);
      process.exitCode = 1;
      return;
    }

    const startedAt = Date.now();
    const running = spawnHarness(config);
    currentChild = running.child;
    log(`Harness 已启动，PID ${running.child.pid ?? "unknown"}，等待 ${config.host}:${config.port}`);

    const ready = await Promise.race([
      waitForPort(config.host, config.port, true).then((ok) => ({ type: "ready", ok })),
      running.exit.then((result) => ({ type: "exit", result }))
    ]);
    let result;
    if (ready.type === "ready") {
      if (ready.ok) log(`Harness 已就绪：http://${config.host}:${config.port}`);
      else log(`Harness 尚未在 ${PORT_WAIT_MS / 1000} 秒内开放端口，继续观察进程。`);
      result = await running.exit;
    } else {
      result = ready.result;
    }
    currentChild = null;
    if (stopping) return;

    const runtimeMs = Date.now() - startedAt;
    if (runtimeMs >= STABLE_RUN_MS) crashCount = 0;
    const effectiveExitCode = running.state.restartRequested ? RESTART_EXIT_CODE : result.code;
    const decision = nextSupervisorAction({ exitCode: effectiveExitCode, crashCount });
    crashCount = decision.crashCount;
    if (result.error !== null) log(`Harness 启动失败：${result.error.message}`);
    else log(`Harness 已退出，代码 ${result.code}${result.signal ? `，信号 ${result.signal}` : ""}`);

    if (decision.action === "stop") {
      if (result.code !== 0) log(`连续异常达到 ${crashCount} 次，停止自动恢复，请查看上方错误。`);
      return;
    }
    if (decision.delayMs > 0) await sleep(decision.delayMs);
  }
}

main().catch((error) => {
  process.stderr.write(`DeepSeek Harness 监督器失败：${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
