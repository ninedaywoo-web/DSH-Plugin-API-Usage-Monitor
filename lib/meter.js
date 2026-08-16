const STATE_VERSION = 2;

function finiteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function toCents(value) {
  if (!finiteNumber(value)) return null;
  return Math.round(value * 100);
}

function toMoney(cents) {
  return cents / 100;
}

function clamp01(value) {
  return Math.min(1, Math.max(0, value));
}

function validV2(state) {
  return state !== null
    && typeof state === "object"
    && state.version === STATE_VERSION
    && typeof state.date === "string"
    && Number.isInteger(state.lastObservedCents)
    && Number.isInteger(state.baselineCents)
    && Number.isInteger(state.todayConsumedCents);
}

function legacyConsumedCents(state, today) {
  if (state === null || typeof state !== "object" || state.date !== today) return 0;
  const opening = toCents(state.opening);
  const low = toCents(state.low);
  if (opening === null || low === null) return 0;
  return Math.max(0, opening - low);
}

function legacyBaselineCents(state, fallback) {
  if (state === null || typeof state !== "object") return fallback;
  const baseline = toCents(state.baseline);
  return baseline !== null && baseline > 0 ? baseline : fallback;
}

/**
 * Advance the persisted balance meter by one confirmed balance observation.
 * Ordinary observations may spend HP but never rebase it. Only the explicit
 * `resetBaseline` action (the user's "已充值，刷新血条" click) starts a new HP bar.
 */
export function advanceMeter(stored, balance, options = {}) {
  const currentCents = toCents(balance);
  if (currentCents === null || currentCents < 0) throw new TypeError("balance must be a non-negative finite number");
  const today = typeof options.today === "string" && options.today !== "" ? options.today : "unknown";
  const resetBaseline = options.resetBaseline === true;

  let baselineCents;
  let consumedCents;
  let previousCents = currentCents;

  if (validV2(stored)) {
    baselineCents = stored.baselineCents > 0 ? stored.baselineCents : currentCents;
    if (stored.date === today) {
      previousCents = stored.lastObservedCents;
      consumedCents = Math.max(0, stored.todayConsumedCents);
      if (currentCents < previousCents) consumedCents += previousCents - currentCents;
    } else {
      consumedCents = 0;
    }
  } else {
    // One-time v1 migration: preserve what the old UI showed, but seed the
    // true "last observed" value from this fresh provider response.
    baselineCents = legacyBaselineCents(stored, currentCents);
    consumedCents = legacyConsumedCents(stored, today);
  }

  if (resetBaseline || baselineCents <= 0) baselineCents = currentCents;
  const dailyBudgetCents = Math.max(1, Math.round(baselineCents / 10));
  const hpFraction = clamp01(currentCents / Math.max(currentCents, baselineCents, 1));
  const postureFraction = clamp01(consumedCents / Math.max(consumedCents, dailyBudgetCents, 1));
  const increaseCents = Math.max(0, currentCents - previousCents);

  return {
    state: {
      version: STATE_VERSION,
      date: today,
      lastObservedCents: currentCents,
      baselineCents,
      todayConsumedCents: consumedCents
    },
    view: {
      baseline: toMoney(baselineCents),
      hpFraction,
      todayConsumed: toMoney(consumedCents),
      dailyBudget: toMoney(dailyBudgetCents),
      postureFraction,
      resetBaseline,
      balanceIncrease: toMoney(increaseCents)
    }
  };
}

export { STATE_VERSION };
