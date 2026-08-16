import test from "node:test";
import assert from "node:assert/strict";

import { advanceMeter } from "../lib/meter.js";

const DAY = "2026-08-16";

function step(state, balance, options = {}) {
  return advanceMeter(state, balance, { today: DAY, ...options });
}

test("normal spending lowers HP and accumulates today's consumption", () => {
  const first = step(null, 100);
  const spent = step(first.state, 95);

  assert.equal(spent.view.baseline, 100);
  assert.equal(spent.view.hpFraction, 0.95);
  assert.equal(spent.view.todayConsumed, 5);
  assert.equal(spent.view.dailyBudget, 10);
  assert.equal(spent.view.postureFraction, 0.5);
});

test("a balance rise never resets HP without an explicit user refresh", () => {
  const initial = step(null, 100);
  const spent = step(initial.state, 80);
  const rose = step(spent.state, 90);

  assert.equal(rose.view.baseline, 100);
  assert.equal(rose.view.hpFraction, 0.9);
  assert.equal(rose.view.todayConsumed, 20);
});

test("manual refresh rebases HP but preserves consumption and recalculates posture budget", () => {
  const initial = step(null, 100);
  const spent = step(initial.state, 95);
  const refreshed = step(spent.state, 120, { resetBaseline: true });

  assert.equal(refreshed.view.baseline, 120);
  assert.equal(refreshed.view.hpFraction, 1);
  assert.equal(refreshed.view.todayConsumed, 5);
  assert.equal(refreshed.view.dailyBudget, 12);
  assert.equal(refreshed.view.postureFraction, 5 / 12);
});

test("an explicit refresh accepts an exact 0.50 balance increase", () => {
  const initial = step(null, 100);
  const refreshed = step(initial.state, 100.5, { resetBaseline: true });

  assert.equal(refreshed.view.baseline, 100.5);
  assert.equal(refreshed.view.hpFraction, 1);
  assert.equal(refreshed.view.todayConsumed, 0);
});

test("spending after a manual recharge remains cumulative", () => {
  const initial = step(null, 100);
  const spent = step(initial.state, 95);
  const refreshed = step(spent.state, 115, { resetBaseline: true });
  const spentAgain = step(refreshed.state, 110);

  assert.equal(spentAgain.view.baseline, 115);
  assert.equal(spentAgain.view.todayConsumed, 10);
  assert.equal(spentAgain.view.hpFraction, 110 / 115);
});

test("a new day clears consumption but keeps the current HP baseline", () => {
  const previous = {
    version: 2,
    date: "2026-08-15",
    lastObservedCents: 8000,
    baselineCents: 10000,
    todayConsumedCents: 2000
  };
  const next = step(previous, 80);

  assert.equal(next.view.baseline, 100);
  assert.equal(next.view.todayConsumed, 0);
  assert.equal(next.view.dailyBudget, 10);
});

test("legacy state migration preserves the visible baseline and consumption", () => {
  const legacy = {
    date: DAY,
    opening: 100,
    last: 100,
    low: 82,
    baseline: 100
  };
  const migrated = step(legacy, 82);

  assert.equal(migrated.state.version, 2);
  assert.equal(migrated.view.baseline, 100);
  assert.equal(migrated.view.todayConsumed, 18);
  assert.equal(migrated.view.hpFraction, 0.82);
});
