import test from "node:test";
import assert from "node:assert/strict";

import {
  checkAgainstPose,
  checkPlausibility,
  checkScale,
  verdictFor,
  worldShoulderCm,
} from "./plausibility";
import type { Measurements } from "./types";
import { CORRECTION } from "./constants";

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


/**
 * World landmarks in metres, with only the shoulders populated.
 * These sit at the joint centres, so a real adult reads ~0.33-0.38m here —
 * narrower than the across-the-shoulders figure a tailor measures.
 */
function world(jointMetres: number) {
  const lm = Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0 }));
  lm[11] = { x: jointMetres / 2, y: 0, z: 0 };
  lm[12] = { x: -jointMetres / 2, y: 0, z: 0 };
  return lm;
}

test("world shoulder width converts metres to cm", () => {
  assert.ok(Math.abs((worldShoulderCm(world(0.42)) ?? 0) - 42) < 1e-6);
  assert.equal(worldShoulderCm(undefined), null);
  assert.equal(worldShoulderCm([]), null);
});

/** World landmarks whose corrected value is exactly `cm`. */
function worldForShoulder(cm: number) {
  return world(cm / CORRECTION.SHOULDER / 100);
}

test("the cross-check compares like with like", () => {
  // Both sides must carry the shoulder correction, or the check is biased on
  // every body and cries wolf. Derived from the constant rather than
  // hardcoded, so this keeps holding if the correction is revised.
  const report = checkAgainstPose(
    { ...REALISTIC, shoulder_width: 44 },
    worldForShoulder(44),
  );
  assert.equal(report.ok, true);
  assert.ok(Math.abs((report.crossCheckCm ?? 0) - 44) < 1e-6);
});

test("the measured shoulder matches a real tape measurement", () => {
  // Ground truth from the field: a subject taping 17in (43.18cm) seam to
  // seam produced a MediaPipe joint-centre span of 32.73cm. The correction
  // must reproduce the tape from the pose path, which owes nothing to the
  // card scale.
  const TAPE_CM = 17 * 2.54;
  const JOINT_SPAN_CM = 32.73;

  const predicted = JOINT_SPAN_CM * CORRECTION.SHOULDER;
  const errorPct = (Math.abs(predicted - TAPE_CM) / TAPE_CM) * 100;
  assert.ok(
    errorPct < 5,
    `shoulder correction predicts ${predicted.toFixed(1)}cm against a ${TAPE_CM.toFixed(1)}cm tape (${errorPct.toFixed(1)}% out)`,
  );
});

test("the pose cross-check catches the real field failure", () => {
  // Second field test: card box placed accurately, but held out in the hands
  // at close range, so everything came out ~1.6x small.
  const short: Measurements = {
    shoulder_width: 27.6,
    chest_width: 28.9,
    chest_circumference: 78.3,
    waist_width: 15.7,
    waist: 42.6,
    hip_width: 20.3,
    hip: 55.1,
  };
  const report = checkAgainstPose(short, worldForShoulder(43.18));
  assert.equal(report.ok, false);
  assert.equal(report.direction, "small");
  assert.ok(Math.abs((report.crossCheckCm ?? 0) - 43.18) < 1e-6);
  assert.match(report.message ?? "", /closer to the camera/);
});

test("the cross-check adapts to a genuinely narrow-shouldered person", () => {
  // A fixed 36-52cm range would wrongly flag this; the cross-check does not,
  // because the pose model sees the same narrow build.
  const narrow = { ...REALISTIC, shoulder_width: 33 };
  assert.equal(checkScale(narrow).ok, false, "the fixed range flags it");
  assert.equal(
    checkAgainstPose(narrow, worldForShoulder(33)).ok,
    true,
    "the cross-check does not",
  );
});

test("the cross-check catches an over-large scale", () => {
  const large = { ...REALISTIC, shoulder_width: 70 };
  const report = checkAgainstPose(large, worldForShoulder(44));
  assert.equal(report.ok, false);
  assert.equal(report.direction, "large");
});

test("the cross-check falls back to the fixed range without world landmarks", () => {
  const short = { ...REALISTIC, shoulder_width: 27.6 };
  const report = checkAgainstPose(short, undefined);
  assert.equal(report.ok, false);
  assert.equal(report.direction, "small");
});

test("normal agreement passes", () => {
  assert.equal(checkAgainstPose(REALISTIC, worldForShoulder(44)).ok, true);
  assert.equal(
    checkAgainstPose(REALISTIC, worldForShoulder(41)).ok,
    true,
    "a few percent of drift is tolerated",
  );
});
