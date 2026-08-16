/**
 * dsh-plugin-api-usage-monitor — host half.
 *
 * Registers one exact HTTP route on the dsh web server:
 *
 *   GET /api/balance-bar
 *
 * which resolves the DeepSeek API key through the credentials seam (the same
 * `DEEPSEEK_API_KEY` reference the llm-deepseek adapter uses), calls DeepSeek's
 * public `/user/balance` endpoint, and returns:
 *
 *   {
 *     ok: true,
 *     currency, totalBalance, grantedBalance,
 *     baseline, hpFraction,                // 血条:余额 / 本管基准(充值后余额)
 *     recharged, rechargedAmount,          // 充值事件(含赠送/退款)
 *     todayConsumed, todayConsumedSource,  // 今日已消费(official | estimate)
 *     postureFraction, dailyBudget,        // 架势条:今日消耗 / 每日预算(余额的 1/10)
 *     todayTokens,                        // 今日 token 总量
 *     todayBuckets: {                     // 悬停明细:三个桶分别多少钱
 *       input:     { tokens, cost },
 *       cacheRead: { tokens, cost },
 *       output:    { tokens, cost }
 *     },
 *     peakWindows, timezone,              // 峰谷时段(北京时间),供前端倒计时
 *     refreshSeconds
 *   }
 *
 * `todayConsumed` sources (DeepSeek 官方未开放用量接口):
 *   1. official — 配置了 `DEEPSEEK_PLATFORM_TOKEN` 凭证时,查询平台控制台
 *      `platform.deepseek.com/api/v0/usage/cost` 取"今天"一行;
 *   2. estimate — 兜底:按当天期初余额 − 当前余额 估算,状态存
 *      `$DSH_HOME/storages/balance-bar-day.json`。
 *
 * `todayBuckets` — 遍历 $DSH_HOME/sessions 下今天有写入的会话,经
 * `sessionPersistence.readRaw` 回放持久化日志,对每条 assistant/message 按
 * 官方价格表(含峰谷)计价,只统计"今天 0 点之后"的事件;再叠加尚未落盘的
 * 进行中会话的实时台账。
 *
 * API key 不出主机:浏览器只访问这条本地路由。
 */
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { closeSync, copyFileSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { costOf, priceAt, DEFAULT_PEAK_WINDOWS, DEFAULT_TIMEZONE } from "./pricing.js";
import { advanceMeter, STATE_VERSION } from "./meter.js";
import { createSupervisorLaunch } from "./launch-platform.js";
import {
  RESTART_EXIT_CODE,
  SUPERVISED_ENV,
  SUPERVISOR_PID_ENV,
  encodeLaunchConfig,
  normalizeHarnessArgv
} from "./restart-policy.js";

const name = "dsh-plugin-api-usage-monitor";
const inject = ["credentials", "webServer"];

const PUBLIC_BASE_URL = "https://api.deepseek.com";
const BASE_URL_ENV = "DEEPSEEK_BASE_URL";
const API_KEY_REF = "DEEPSEEK_API_KEY";
const PLATFORM_TOKEN_REF = "DEEPSEEK_PLATFORM_TOKEN";
const BALANCE_PATH = "/user/balance";
const ROUTE_PATH = "/api/balance-bar";
const RESTART_ROUTE_PATH = "/api/balance-bar/restart";
const ICON_ROUTE_PATH = "/api/balance-bar/icons";
const ICON_ALLOW = new Set(["liangzi", "liangshen"]);
const ASSETS_DIR = fileURLToPath(new URL("../assets/", import.meta.url));
const TIMEOUT_MS = 15000;
const DAY_STATE_FILE = "balance-bar-day.json";
const PLATFORM_USAGE_URL = "https://platform.deepseek.com/api/v0/usage/cost";
const SUPERVISOR_PATH = fileURLToPath(new URL("./supervisor.js", import.meta.url));

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store"
};

function localDate(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function toFinite(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : NaN;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : NaN;
  }
  return NaN;
}

function round2(value) {
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 100) / 100;
}

function round6(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 1e6) / 1e6;
}

function balanceUrl() {
  const base = process.env[BASE_URL_ENV] ?? PUBLIC_BASE_URL;
  return `${base.replace(/\/+$/, "")}${BALANCE_PATH}`;
}

function sendJson(res, status, body) {
  res.writeHead(status, JSON_HEADERS);
  res.end(JSON.stringify(body));
}

function providerMessage(text, status) {
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed.error === "object" && parsed.error !== null && typeof parsed.error.message === "string") {
      return parsed.error.message;
    }
  } catch {}
  return `DeepSeek 接口返回 HTTP ${status}`;
}

/** 定位 $DSH_HOME(storages 的上级目录)。 */
function dshHome(ctx) {
  const homeFn = typeof ctx.get === "function" ? ctx.get("dshHomePath") : void 0;
  if (typeof homeFn === "function") {
    try {
      const v = homeFn();
      if (typeof v === "string" && v !== "") return v;
    } catch {}
  }
  if (process.env.DSH_HOME) return process.env.DSH_HOME;
  return join(homedir(), ".dsh");
}

function dayStatePath(ctx) {
  return join(dshHome(ctx), "storages", DAY_STATE_FILE);
}

function loadDayState(path) {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    if (parsed !== null && typeof parsed === "object" && typeof parsed.date === "string") {
      return parsed;
    }
  } catch {}
  return null;
}

function saveDayState(path, state) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  try {
    writeFileSync(tmp, JSON.stringify(state), "utf8");
    renameSync(tmp, path);
  } finally {
    try {
      if (existsSync(tmp)) unlinkSync(tmp);
    } catch {}
  }
}

/** 普通观测只累计消费；只有用户明确点击“已充值，刷新血条”才重设满血上限。 */
function advanceDayMeter(ctx, balance, options = {}) {
  const path = dayStatePath(ctx);
  const today = localDate();
  const stored = loadDayState(path);
  if (stored !== null && stored.version !== STATE_VERSION && existsSync(path)) {
    const backup = `${path}.v1.bak`;
    if (!existsSync(backup)) copyFileSync(path, backup);
  }
  const next = advanceMeter(stored, balance, {
    today,
    resetBaseline: options.resetBaseline === true
  });
  saveDayState(path, next.state);
  return {
    consumedEstimate: next.view.todayConsumed,
    recharged: next.view.resetBaseline,
    rechargedAmount: next.view.balanceIncrease,
    baseline: next.view.baseline,
    hpFraction: next.view.hpFraction,
    dailyBudget: next.view.dailyBudget,
    postureFraction: next.view.postureFraction
  };
}

/** 官方平台"今日消费"(需 DEEPSEEK_PLATFORM_TOKEN)。失败抛错/返回 null,由调用方兜底。 */
async function fetchPlatformTodayCost(token) {
  const now = new Date();
  const url = `${PLATFORM_USAGE_URL}?month=${now.getMonth() + 1}&year=${now.getFullYear()}`;
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "x-app-version": "1.0.0",
      Origin: "https://platform.deepseek.com",
      Referer: "https://platform.deepseek.com/usage"
    },
    signal: AbortSignal.timeout(TIMEOUT_MS)
  });
  if (!response.ok) throw new Error(`DeepSeek 平台用量接口返回 HTTP ${response.status}`);
  const body = await response.json();
  const biz = body && typeof body === "object" ? body.data : void 0;
  if (body?.code !== 0 || biz === void 0 || biz.biz_code !== 0) {
    throw new Error(`DeepSeek 平台用量接口错误 (code ${body?.code ?? biz?.biz_code ?? "unknown"})`);
  }
  const bizData = biz.biz_data;
  const container = Array.isArray(bizData) ? bizData[0] : bizData;
  const days = container && typeof container === "object" ? container.days : void 0;
  if (!Array.isArray(days)) return null;
  const today = localDate();
  const entry = days.find((d) => d && d.date === today);
  if (!entry || !Array.isArray(entry.data)) return null;
  let total = 0;
  for (const modelEntry of entry.data) {
    if (!modelEntry || typeof modelEntry !== "object" || !Array.isArray(modelEntry.usage)) continue;
    for (const u of modelEntry.usage) {
      if (!u || typeof u !== "object") continue;
      const value = toFinite(u.cost ?? u.amount);
      if (Number.isFinite(value)) total += value;
    }
  }
  return Math.round(total * 100) / 100;
}

/** 今天 0 点的时间戳(毫秒)。 */
function startOfTodayMs() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** 今天(按日志文件 mtime)有写入的会话:Map<sessionId, 文件 mtimeMs>。 */
function listTodaySessionIds(ctx) {
  const root = join(dshHome(ctx), "sessions");
  const start = startOfTodayMs();
  const map = new Map();
  let workspaces;
  try {
    workspaces = readdirSync(root);
  } catch {
    return map;
  }
  for (const ws of workspaces) {
    let dirs;
    try {
      dirs = readdirSync(join(root, ws), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const d of dirs) {
      if (!d.isDirectory()) continue;
      try {
        const st = statSync(join(root, ws, d.name, "session.jsonl.zstd"));
        if (st.mtimeMs >= start) map.set(d.name, st.mtimeMs);
      } catch {}
    }
  }
  return map;
}

/** 空的分桶记录。 */
function emptyBuckets() {
  return {
    input: { tokens: 0, cost: 0 },
    cacheRead: { tokens: 0, cost: 0 },
    output: { tokens: 0, cost: 0 }
  };
}

/** 把一条 assistant/message 事件按官方价格表计入分桶记录;返回是否计入。 */
function priceEventInto(buckets, event) {
  const data = event && typeof event === "object" ? event.data : void 0;
  const usage = data?.usage;
  if (usage === void 0 || usage === null) return false;
  if (typeof usage.outputTokens !== "number" && typeof usage.inputTokens !== "number") return false;
  const model = typeof data.message?.source?.model === "string" ? data.message.source.model : "unknown";
  const timeRaw = Number(event.time);
  const timeMs = Number.isFinite(timeRaw) ? timeRaw : Date.now();
  const unit = priceAt(model, timeMs);
  const sample = costOf(usage, unit);
  buckets.input.tokens += sample.inputTokens;
  buckets.input.cost += (sample.inputTokens * unit.cny.input) / 1e6;
  buckets.cacheRead.tokens += sample.cacheReadTokens;
  buckets.cacheRead.cost += (sample.cacheReadTokens * unit.cny.cacheRead) / 1e6;
  buckets.output.tokens += sample.outputTokens;
  buckets.output.cost += (sample.outputTokens * unit.cny.output) / 1e6;
  return true;
}

const replayCache = new Map(); // sessionId -> { key, dayStart, buckets, at }
const REPLAY_CACHE_MAX = 64;

/** 缓存写入:超过上限时淘汰最旧条目,防止长期运行内存缓慢增长。 */
function cachePut(id, entry) {
  if (replayCache.size >= REPLAY_CACHE_MAX && !replayCache.has(id)) {
    let oldestId = null;
    let oldestAt = Infinity;
    for (const [key, value] of replayCache) {
      if (value.at < oldestAt) {
        oldestAt = value.at;
        oldestId = key;
      }
    }
    if (oldestId !== null) replayCache.delete(oldestId);
  }
  replayCache.set(id, entry);
}

/** 回放今天各会话日志,按桶累计 token 与费用;叠加未落盘会话的实时台账。 */
async function sumToday(ctx, liveLedger) {
  const sessionFiles = listTodaySessionIds(ctx);
  const ids = [...sessionFiles.keys()];
  const persistence = ctx.get("sessionPersistence");
  const onDisk = new Set(ids);
  const dayStart = startOfTodayMs();
  const totals = emptyBuckets();
  if (persistence !== void 0 && typeof persistence.readRaw === "function") {
    for (const id of ids) {
      try {
        let rev;
        try {
          if (typeof persistence.readStoredRevision === "function") rev = await persistence.readStoredRevision(id);
        } catch {}
        // 缓存键:优先版本号,读不到时用日志文件 mtime 兜底(避免每 60 秒全量重放)
        const cacheKey = rev !== void 0 ? rev : (sessionFiles.get(id) ?? 0);
        const cached = replayCache.get(id);
        if (cached !== void 0 && cached.key === cacheKey && cached.dayStart === dayStart) {
          totals.input.tokens += cached.buckets.input.tokens;
          totals.input.cost += cached.buckets.input.cost;
          totals.cacheRead.tokens += cached.buckets.cacheRead.tokens;
          totals.cacheRead.cost += cached.buckets.cacheRead.cost;
          totals.output.tokens += cached.buckets.output.tokens;
          totals.output.cost += cached.buckets.output.cost;
          continue;
        }
        const raw = await persistence.readRaw(id);
        if (raw === void 0 || raw === null || typeof raw.content !== "string") continue;
        const buckets = emptyBuckets();
        for (const line of raw.content.split("\n")) {
          if (line === "") continue;
          let event;
          try {
            event = JSON.parse(line);
          } catch {
            continue;
          }
          if (event === null || typeof event !== "object" || event.type !== "assistant/message") continue;
          const time = Number(event.time);
          if (Number.isFinite(time) && time < dayStart) continue;
          priceEventInto(buckets, event);
        }
        cachePut(id, { key: cacheKey, buckets, at: Date.now(), dayStart });
        totals.input.tokens += buckets.input.tokens;
        totals.input.cost += buckets.input.cost;
        totals.cacheRead.tokens += buckets.cacheRead.tokens;
        totals.cacheRead.cost += buckets.cacheRead.cost;
        totals.output.tokens += buckets.output.tokens;
        totals.output.cost += buckets.output.cost;
      } catch (error) {
        ctx.logger.warn(`dsh-plugin-api-usage-monitor: replay ${id} failed`);
        ctx.logger.warn(error);
      }
    }
  }
  for (const [id, buckets] of liveLedger) {
    if (onDisk.has(id)) continue;
    totals.input.tokens += buckets.input.tokens;
    totals.input.cost += buckets.input.cost;
    totals.cacheRead.tokens += buckets.cacheRead.tokens;
    totals.cacheRead.cost += buckets.cacheRead.cost;
    totals.output.tokens += buckets.output.tokens;
    totals.output.cost += buckets.output.cost;
  }
  return {
    todayTokens: totals.input.tokens + totals.cacheRead.tokens + totals.output.tokens,
    buckets: {
      input: { tokens: totals.input.tokens, cost: round6(totals.input.cost) },
      cacheRead: { tokens: totals.cacheRead.tokens, cost: round6(totals.cacheRead.cost) },
      output: { tokens: totals.output.tokens, cost: round6(totals.output.cost) }
    }
  };
}

function processAlive(pid) {
  if (!Number.isInteger(pid) || pid < 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function isSupervised() {
  const supervisorPid = Number(process.env[SUPERVISOR_PID_ENV]);
  return process.env[SUPERVISED_ENV] === "1"
    && processAlive(supervisorPid)
    && typeof process.send === "function";
}

function gracefulExit(fallbackCode) {
  if (process.listenerCount("SIGTERM") > 0) {
    process.emit("SIGTERM");
    return;
  }
  process.exit(fallbackCode);
}

/** One-time handoff: start a minimized-console supervisor that owns all later restarts. */
async function startSupervisor(ctx, port) {
  const encoded = encodeLaunchConfig({
    execPath: process.execPath,
    execArgv: [...process.execArgv],
    argv: normalizeHarnessArgv(process.argv.slice(1), port),
    cwd: process.cwd(),
    host: "127.0.0.1",
    port,
    waitForPid: process.pid
  });
  const launch = createSupervisorLaunch({
    platform: process.platform,
    execPath: process.execPath,
    supervisorPath: SUPERVISOR_PATH,
    encodedConfig: encoded,
    cwd: process.cwd()
  });
  let logFd = null;
  let child;
  try {
    let stdio = "ignore";
    if (launch.output === "log") {
      const logDir = join(dshHome(ctx), "logs");
      mkdirSync(logDir, { recursive: true });
      logFd = openSync(join(logDir, "dsh-balance-bar-supervisor.log"), "a");
      stdio = ["ignore", logFd, logFd];
    }
    child = spawn(launch.command, launch.args, {
      cwd: launch.cwd,
      env: process.env,
      detached: launch.detached,
      stdio,
      windowsHide: launch.windowsHide
    });
  } finally {
    if (logFd !== null) closeSync(logFd);
  }
  await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("spawn", resolve);
  });
  child.unref();
}

/** True when the request's Origin matches its Host (same-origin guard for POST)。 */
function sameOrigin(request) {
  const origin = request.headers.origin;
  const host = request.headers.host;
  if (origin === undefined || host === undefined) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/** 重启请求必须直接来自环回地址(拒绝代理转发)。 */
function isLoopback(request) {
  const remote = request.socket?.remoteAddress ?? "";
  return remote === "127.0.0.1" || remote === "::1" || remote === "::ffff:127.0.0.1";
}

export function apply(ctx, config) {
  const cfg = {
    refreshSeconds: Number.isFinite(Number(config?.refreshSeconds)) && Number(config.refreshSeconds) >= 10 ? Number(config.refreshSeconds) : 60
  };
  const instanceId = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  let restartPending = false;

  // 多个标签页同时刷新时共用一次上游余额请求，避免旧响应倒序改写台账。
  let balanceFetchInFlight = null;
  let balanceFetchKey = null;
  const fetchProviderBalance = async (apiKey) => {
    if (balanceFetchInFlight !== null && balanceFetchKey === apiKey) return balanceFetchInFlight;
    const task = (async () => {
      const response = await fetch(balanceUrl(), {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: "application/json"
        },
        signal: AbortSignal.timeout(TIMEOUT_MS)
      });
      return {
        ok: response.ok,
        status: response.status,
        text: await response.text()
      };
    })();
    balanceFetchInFlight = task;
    balanceFetchKey = apiKey;
    try {
      return await task;
    } finally {
      if (balanceFetchInFlight === task) {
        balanceFetchInFlight = null;
        balanceFetchKey = null;
      }
    }
  };

  // 实时台账:覆盖尚未落盘的进行中会话(累加)。
  const liveLedger = new Map();
  ctx.on("session/event", (session, event) => {
    try {
      if (event?.type !== "assistant/message") return;
      let buckets = liveLedger.get(session.id);
      if (buckets === void 0) {
        buckets = emptyBuckets();
        liveLedger.set(session.id, buckets);
      }
      priceEventInto(buckets, event);
    } catch {}
  });

  ctx.effect(() => ctx.webServer.register({
    kind: "exact",
    path: ROUTE_PATH,
    handler: async (req, res) => {
      try {
        const resetBaseline = req.method === "POST";
        if (req.method !== "GET" && !resetBaseline) {
          sendJson(res, 405, { ok: false, error: "method", message: "GET or POST only" });
          return;
        }
        if (resetBaseline && (!sameOrigin(req) || !isLoopback(req))) {
          sendJson(res, 403, { ok: false, error: "origin", message: "same-origin loopback only" });
          return;
        }
        const hit = await ctx.credentials.resolve(API_KEY_REF);
        if (hit === void 0 || typeof hit.value !== "string" || hit.value === "") {
          sendJson(res, 503, {
            ok: false,
            error: "no-api-key",
            message: "未配置 DEEPSEEK_API_KEY：请在 设置 → 模型 中填写 DeepSeek API Key。",
            instanceId
          });
          return;
        }
        const provider = await fetchProviderBalance(hit.value);
        if (!provider.ok) {
          sendJson(res, provider.status, {
            ok: false,
            error: "provider",
            message: providerMessage(provider.text, provider.status),
            instanceId
          });
          return;
        }
        let body = null;
        try {
          body = JSON.parse(provider.text);
        } catch {}
        const infos = Array.isArray(body?.balance_infos) ? body.balance_infos : [];
        const first = infos[0] ?? {};
        const total = toFinite(first.total_balance);
        const granted = toFinite(first.granted_balance);
        const currency = typeof first.currency === "string" && first.currency !== "" ? first.currency : "CNY";
        if (!Number.isFinite(total) || total < 0) throw new Error("DeepSeek 余额接口未返回有效余额");

        // 普通 GET 只推进消费；POST 表示用户明确要求以当前余额刷新满血上限。
        const meter = advanceDayMeter(ctx, total, { resetBaseline });

        // 今日已消费:官方平台数据优先,余额差值估算兜底。
        let todayConsumed = meter.consumedEstimate;
        let todayConsumedSource = "estimate";
        const platformHit = await ctx.credentials.resolve(PLATFORM_TOKEN_REF);
        if (platformHit !== void 0) {
          try {
            const official = await fetchPlatformTodayCost(platformHit.value);
            if (official !== null) {
              todayConsumed = official;
              todayConsumedSource = "official";
            }
          } catch (error) {
            ctx.logger.warn("dsh-plugin-api-usage-monitor: platform usage fetch failed; falling back to balance-delta estimate");
            ctx.logger.warn(error);
          }
        }

        const today = await sumToday(ctx, liveLedger);
        // 架势条金额不因充值清零；上限随用户确认后的新血条基准调整。
        const baseline = meter.baseline;
        const hpFraction = meter.hpFraction;
        const dailyBudget = meter.dailyBudget;
        const postureFraction = typeof todayConsumed === "number"
          ? Math.min(1, Math.max(0, todayConsumed / Math.max(dailyBudget, todayConsumed, 0.01)))
          : 0;

        sendJson(res, 200, {
          ok: true,
          currency,
          totalBalance: round2(total),
          grantedBalance: round2(granted),
          baseline: round2(baseline),
          hpFraction,
          recharged: meter.recharged,
          rechargedAmount: round2(meter.rechargedAmount),
          todayConsumed,
          todayConsumedSource,
          postureFraction,
          dailyBudget: round2(dailyBudget),
          todayTokens: today.todayTokens,
          todayBuckets: today.buckets,
          peakWindows: DEFAULT_PEAK_WINDOWS,
          timezone: DEFAULT_TIMEZONE,
          refreshSeconds: cfg.refreshSeconds,
          baselineReset: resetBaseline,
          instanceId
        });
      } catch (error) {
        ctx.logger.warn("dsh-plugin-api-usage-monitor: failed to serve balance");
        ctx.logger.warn(error);
        sendJson(res, 502, {
          ok: false,
          error: "fetch-failed",
          message: error instanceof Error ? error.message : String(error),
          instanceId
        });
      }
    }
  }), "dsh-plugin-api-usage-monitor: route");

  // 一键重启:仅接受同源 + 环回直连的 POST。
  ctx.effect(() => ctx.webServer.register({
    kind: "exact",
    path: RESTART_ROUTE_PATH,
    handler: async (req, res) => {
      if (req.method !== "POST") {
        sendJson(res, 405, { ok: false, error: "method", message: "POST only" });
        return;
      }
      if (!sameOrigin(req)) {
        sendJson(res, 403, { ok: false, error: "origin", message: "same-origin only" });
        return;
      }
      if (!isLoopback(req)) {
        sendJson(res, 403, { ok: false, error: "origin", message: "loopback only" });
        return;
      }
      if (restartPending) {
        sendJson(res, 409, { ok: false, error: "restart-pending", message: "restart already pending" });
        return;
      }
      restartPending = true;
      const supervised = isSupervised();
      try {
        if (!supervised) await startSupervisor(ctx, req.socket?.localPort ?? 3080);
      } catch (error) {
        restartPending = false;
        ctx.logger.warn("dsh-plugin-api-usage-monitor: supervisor bootstrap failed");
        ctx.logger.warn(error);
        sendJson(res, 500, {
          ok: false,
          error: "supervisor-start-failed",
          message: error instanceof Error ? error.message : String(error)
        });
        return;
      }

      res.once("finish", () => {
        // 先完整发送响应，再让 DSH 自己的 SIGTERM 处理器清理会话和插件。
        setTimeout(() => {
          if (!supervised) {
            gracefulExit(0);
            return;
          }
          process.send({ type: "dsh-balance-restart", instanceId }, (error) => {
            if (error) {
              process.exit(RESTART_EXIT_CODE);
              return;
            }
            gracefulExit(RESTART_EXIT_CODE);
          });
        }, 50);
      });
      sendJson(res, 202, {
        ok: true,
        message: supervised ? "restarting" : "starting supervisor",
        instanceId,
        supervised
      });
    }
  }), "dsh-plugin-api-usage-monitor: restart route");

  // 状态图标:白名单文件,GET 直出,无路径穿越。
  ctx.effect(() => ctx.webServer.register({
    kind: "prefix",
    path: ICON_ROUTE_PATH,
    handler: (req, res) => {
      const raw = req.url ?? "";
      const rest = raw.slice(raw.indexOf(ICON_ROUTE_PATH) + ICON_ROUTE_PATH.length);
      const name = rest.split("?")[0].split("#")[0].split("/").filter((part) => part !== "")[0] ?? "";
      if (!ICON_ALLOW.has(name)) {
        sendJson(res, 404, { ok: false, error: "not-found", message: "icon not found" });
        return;
      }
      const file = join(ASSETS_DIR, `${name}.png`);
      if (!existsSync(file)) {
        sendJson(res, 404, { ok: false, error: "not-found", message: "icon file missing" });
        return;
      }
      try {
        const data = readFileSync(file);
        res.writeHead(200, {
          "content-type": "image/png",
          "cache-control": "public, max-age=86400"
        });
        res.end(data);
      } catch (error) {
        sendJson(res, 500, { ok: false, error: "read-failed", message: error instanceof Error ? error.message : String(error) });
      }
    }
  }), "dsh-plugin-api-usage-monitor: icon route");
}

export { name, inject };
