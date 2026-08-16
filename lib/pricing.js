/**
 * DeepSeek 官方价格引擎(纯函数,无依赖)。
 *
 * 移植自 bpc-oss/dsh-web-billing(MIT):
 *   https://github.com/bpc-oss/dsh-web-billing
 * 价格表策展自 DeepSeek 官方公告:
 *   https://api-docs.deepseek.com/zh-cn/quick_start/pricing/
 * 官方如有调整,在此文件同步更新。
 *
 * 语义约定:
 * - input      缓存未命中输入
 * - cacheRead  缓存命中输入
 * - output     输出
 * 单价单位:每 1M tokens,人民币(cny)/美元(usd)。
 */

/** 峰谷判定的默认时区(北京时间)。 */
export const DEFAULT_TIMEZONE = "Asia/Shanghai";

/** 官方高峰时段(本地小时,[start, end) 闭开区间)。 */
export const DEFAULT_PEAK_WINDOWS = [[9, 12], [14, 18]];

const ZERO_UNIT = Object.freeze({ input: 0, cacheRead: 0, output: 0 });

/** 官方政策时间表(since 为生效时刻,含时区偏移)。 */
export const OFFICIAL_PRICING_POLICIES = [
  {
    since: "2025-02-09T00:00:00+08:00",
    label: "deepseek-chat / deepseek-reasoner 标准价(2025-02-09 优惠期结束)",
    prices: {
      "deepseek-chat": {
        cny: { input: 2, cacheRead: 0.5, output: 8 },
        usd: { input: 0.27, cacheRead: 0.07, output: 1.1 }
      },
      "deepseek-reasoner": {
        cny: { input: 4, cacheRead: 1, output: 16 },
        usd: { input: 0.55, cacheRead: 0.14, output: 2.19 }
      },
      "*": {
        cny: { input: 2, cacheRead: 0.5, output: 8 },
        usd: { input: 0.27, cacheRead: 0.07, output: 1.1 }
      }
    }
  },
  {
    since: "2026-05-22T00:00:00+08:00",
    label: "V4 系列 75% 降价转永久(deepseek-v4-flash / deepseek-v4-pro 上线)",
    prices: {
      "deepseek-v4-flash": {
        cny: { input: 1, cacheRead: 0.02, output: 2 },
        usd: { input: 0.14, cacheRead: 0.0028, output: 0.28 }
      },
      "deepseek-v4-pro": {
        cny: { input: 3, cacheRead: 0.025, output: 6 },
        usd: { input: 0.435, cacheRead: 0.003625, output: 0.87 }
      },
      "*": {
        cny: { input: 1, cacheRead: 0.02, output: 2 },
        usd: { input: 0.14, cacheRead: 0.0028, output: 0.28 }
      }
    }
  },
  {
    since: "2026-08-17T00:00:00+08:00",
    label: "峰谷定价:高峰 09:00-12:00 / 14:00-18:00(北京时间),空闲时段半价",
    peak: {
      "deepseek-v4-flash": {
        cny: { input: 3, cacheRead: 0.1, output: 9 },
        usd: { input: 0.44, cacheRead: 0.014, output: 1.32 }
      },
      "deepseek-v4-pro": {
        cny: { input: 9, cacheRead: 0.3, output: 27 },
        usd: { input: 1.32, cacheRead: 0.044, output: 3.96 }
      },
      "*": {
        cny: { input: 3, cacheRead: 0.1, output: 9 },
        usd: { input: 0.44, cacheRead: 0.014, output: 1.32 }
      }
    },
    offPeak: {
      "deepseek-v4-flash": {
        cny: { input: 1.5, cacheRead: 0.05, output: 4.5 },
        usd: { input: 0.22, cacheRead: 0.007, output: 0.66 }
      },
      "deepseek-v4-pro": {
        cny: { input: 4.5, cacheRead: 0.15, output: 13.5 },
        usd: { input: 0.66, cacheRead: 0.022, output: 1.98 }
      },
      "*": {
        cny: { input: 1.5, cacheRead: 0.05, output: 4.5 },
        usd: { input: 0.22, cacheRead: 0.007, output: 0.66 }
      }
    }
  }
];

/** 某时刻是否处于高峰时段(按指定时区与窗口判定;窗口为 [start, end) 小时)。 */
export function isPeak(timeMs, timezone = DEFAULT_TIMEZONE, windows = DEFAULT_PEAK_WINDOWS) {
  let hour;
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour12: false,
      hour: "numeric"
    }).formatToParts(new Date(timeMs));
    hour = Number(parts.find((part) => part.type === "hour")?.value ?? "0") % 24;
  } catch {
    hour = -1;
  }
  return windows.some(([start, end]) => hour >= start && hour < end);
}

/** 在单张价格表内取模型单价(含 `*` 兜底)。 */
function priceFor(model, table) {
  return table[model] ?? table["*"] ?? ZERO_UNIT;
}

/** 计算某模型在某一时刻的单价(双币种),返回 { cny, usd, mode, label }。 */
export function priceAt(model, timeMs, opts) {
  const { timezone = DEFAULT_TIMEZONE, peakWindows = DEFAULT_PEAK_WINDOWS, policies = OFFICIAL_PRICING_POLICIES } = opts ?? {};
  const peak = isPeak(timeMs, timezone, peakWindows);
  const applicable = policies.filter((policy) => timeMs >= Date.parse(policy.since));
  const scope = applicable.length > 0 ? applicable : [policies[0]];
  let table;
  let winner = scope[scope.length - 1];
  for (let index = scope.length - 1; index >= 0; index--) {
    const policy = scope[index];
    const candidate = policy.peak !== void 0 && policy.offPeak !== void 0
      ? (peak ? policy.peak : policy.offPeak)
      : policy.prices;
    if (candidate[model] !== void 0 || candidate["*"] !== void 0) {
      winner = policy;
      table = candidate;
      break;
    }
  }
  if (table === void 0) {
    const latest = scope[scope.length - 1];
    table = latest.peak !== void 0 && latest.offPeak !== void 0
      ? (peak ? latest.peak : latest.offPeak)
      : latest.prices;
  }
  const unit = priceFor(model, table);
  const mode = winner.peak !== void 0 && winner.offPeak !== void 0 ? (peak ? "peak" : "offPeak") : "flat";
  return { cny: unit.cny, usd: unit.usd, mode, label: winner.label };
}

/**
 * 按 TokenUsage 与单价计算费用(双币种)与 token 拆分。
 * @param usage - { inputTokens, cacheReadTokens?, outputTokens }
 * @param unit  - priceAt 返回值。
 */
export function costOf(usage, unit) {
  const inputTokens = usage.inputTokens ?? 0;
  const cacheReadTokens = usage.cacheReadTokens ?? 0;
  const outputTokens = usage.outputTokens ?? 0;
  const cost = (inputTokens * unit.cny.input + cacheReadTokens * unit.cny.cacheRead + outputTokens * unit.cny.output) / 1e6;
  const costUsd = (inputTokens * unit.usd.input + cacheReadTokens * unit.usd.cacheRead + outputTokens * unit.usd.output) / 1e6;
  return { inputTokens, cacheReadTokens, outputTokens, cost, costUsd };
}
