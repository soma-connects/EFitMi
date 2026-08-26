import test from "node:test";
import assert from "node:assert/strict";

import { checkPlausibility, verdictFor } from "./plausibility";
import type { Measurements } from "./types";

/** A set of readings that a tape measure would agree with. */
const REALISTIC: Measurements = {
  shoulder_width: 44,
  chest_width: 36,
  chest_circumference: 98,
  waist_width: 32,
  waist: 84,
  hip_width: 36,
  hip: 96,
};

function scaled(factor: number): Measurements {
  return Object.fromEntries(
    Object.entries(REALISTIC).map(([k, v]) => [k, v * factor]),
  ) as unknown as Measurements;
}

test("a realistic body passes", () => {
  const report = checkPlausibility(REALISTIC);
  assert.equal(report.ok, true);
  assert.equal(report.message, null);
});

test("a card box drawn too small inflates everything, and is named as such", () => {
  const report = checkPlausibility(scaled(3));
  assert.equal(report.ok, false);
  assert.equal(report.skew, "high");
  assert.match(report.message ?? "", /smaller than the actual card/);
});

test("a card box drawn too large deflates everything, and is named as such", () => {
  const report = checkPlausibility(scaled(0.2));
  assert.equal(report.ok, false);
  assert.equal(report.skew, "low");
  assert.match(report.message ?? "", /larger than the actual card/);
});

test("individual values are flagged in the direction they fail", () => {
  assert.equal(verdictFor("shoulder_width", 44), "ok");
  assert.equal(verdictFor("shoulder_width", 8), "low");
  assert.equal(verdictFor("shoulder_width", 300), "high");
});

test("bounds are wide enough not to reject real human variation", () => {
  // A small adult and a large adult must both pass; the check exists to
  // catch broken calibration, not to police body size.
  assert.equal(checkPlausibility(scaled(0.8)).ok, true);
  assert.equal(checkPlausibility(scaled(1.25)).ok, true);
});
