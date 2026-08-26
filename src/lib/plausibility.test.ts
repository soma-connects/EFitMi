import test from "node:test";
import assert from "node:assert/strict";

import { checkPlausibility, checkScale, verdictFor } from "./plausibility";
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

test("a mis-scaled adult is caught even when every value is 'possible'", () => {
  // The real-world failure: a card held out in front of the body reads
  // larger than it is, so everything comes out ~30% short. Each value
  // stayed inside the impossible-bounds, so nothing was flagged.
  const short: Measurements = {
    shoulder_width: 31.6,
    chest_width: 33.1,
    chest_circumference: 89.7,
    waist_width: 18.6,
    waist: 50.4,
    hip_width: 24.0,
    hip: 65.2,
  };
  assert.equal(checkPlausibility(short).ok, true, "hard bounds do not catch this");

  const scale = checkScale(short);
  assert.equal(scale.ok, false);
  assert.equal(scale.direction, "small");
  assert.match(scale.message ?? "", /in front of you/);
});

test("the scale check accepts a normal adult", () => {
  assert.equal(checkScale(REALISTIC).ok, true);
});

test("the scale check catches the opposite error too", () => {
  const large = { ...REALISTIC, shoulder_width: 61 };
  const scale = checkScale(large);
  assert.equal(scale.ok, false);
  assert.equal(scale.direction, "large");
});

test("the scale check does not flag the edges of normal adult builds", () => {
  for (const shoulder of [36, 40, 44, 48, 52]) {
    assert.equal(
      checkScale({ ...REALISTIC, shoulder_width: shoulder }).ok,
      true,
      `${shoulder}cm should not be flagged`,
    );
  }
});
