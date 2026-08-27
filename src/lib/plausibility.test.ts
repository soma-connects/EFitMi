import test from "node:test";
import assert from "node:assert/strict";

import {
  checkAgainstPose,
  checkConsistency,
  checkPlausibility,
  checkScale,
  checkSquareness,
  torsoRotation,
  verdictFor,
  worldShoulderCm,
} from "./plausibility";
import type { Measurements } from "./types";
import { CORRECTION, EASE_CM } from "./constants";

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
  // Ground truth from a tailor's measurement sheet: this subject's body
  // shoulder is 18in (19in is the same shoulder plus wearing ease), against
  // a MediaPipe joint-centre span of 32.73cm. The correction must reproduce
  // the tape from the pose path, which owes nothing to the card scale.
  const TAPE_CM = 18 * 2.54;
  const JOINT_SPAN_CM = 32.73;

  const predicted = JOINT_SPAN_CM * CORRECTION.SHOULDER;
  const errorPct = (Math.abs(predicted - TAPE_CM) / TAPE_CM) * 100;
  assert.ok(
    errorPct < 5,
    `shoulder correction predicts ${predicted.toFixed(1)}cm against a ${TAPE_CM.toFixed(1)}cm tape (${errorPct.toFixed(1)}% out)`,
  );
});

test("the measured chest matches a real tape measurement", () => {
  // Same sheet: a 37in tight chest (40in is the same chest with ease).
  // Chest width comes from the shoulder landmark span, and the elliptical
  // model converts width to circumference by a fixed factor, so the
  // card-independent pose span pins the chest correction the same way the
  // shoulder one was pinned.
  const TAPE_CHEST_CM = 37 * 2.54;
  const JOINT_SPAN_CM = 32.73;

  // C = 2*pi*sqrt((a^2 + b^2)/2) with a = w/2 and b = 0.35w.
  const WIDTH_TO_CIRCUMFERENCE =
    2 * Math.PI * Math.sqrt((0.25 + 0.35 * 0.35) / 2);

  const predicted =
    JOINT_SPAN_CM * CORRECTION.CHEST * WIDTH_TO_CIRCUMFERENCE;
  const errorPct = (Math.abs(predicted - TAPE_CHEST_CM) / TAPE_CHEST_CM) * 100;
  assert.ok(
    errorPct < 5,
    `chest correction predicts ${predicted.toFixed(1)}cm against a ${TAPE_CHEST_CM.toFixed(1)}cm tape (${errorPct.toFixed(1)}% out)`,
  );
});

test("the measured waist matches a real tape measurement", () => {
  // Third figure from the same sheet: a 38in waist, confirmed by the subject
  // as his actual body measurement rather than a trouser reading over
  // clothing (39in is the same waist with ease). Waist width derives from the
  // card-independent hip landmark span of 19.64cm, which pins this the same
  // way the shoulder and chest corrections were pinned.
  const TARGET_CM = 38 * 2.54;
  const HIP_SPAN_CM = 19.64;
  const WIDTH_TO_CIRCUMFERENCE =
    2 * Math.PI * Math.sqrt((0.25 + 0.35 * 0.35) / 2);

  const predicted =
    HIP_SPAN_CM * 0.9 * CORRECTION.WAIST * WIDTH_TO_CIRCUMFERENCE;
  const errorPct = (Math.abs(predicted - TARGET_CM) / TARGET_CM) * 100;
  assert.ok(
    errorPct < 5,
    `waist correction predicts ${predicted.toFixed(1)}cm against a ${TARGET_CM.toFixed(1)}cm tape (${errorPct.toFixed(1)}% out)`,
  );
});

test("hip is still the unvalidated inherited constant", () => {
  // Pinned so a future change is a conscious act, not drift.
  assert.equal(CORRECTION.HIP, 1.35);
});

test("a waist far above the hip is flagged, not shipped", () => {
  // Exactly the state calibrating waist alone produces: waist reads ~38in
  // while hip, sharing the same landmarks with an uncalibrated constant,
  // reads ~28in. Each value passes its own bounds; only comparing them
  // catches it.
  const backwards: Measurements = {
    ...REALISTIC,
    waist: 96.5,
    hip: 72,
  };
  assert.equal(checkPlausibility(backwards).ok, true, "per-value bounds miss it");

  const report = checkConsistency(backwards);
  assert.equal(report.ok, false);
  assert.match(report.message ?? "", /hip is reading low/);
});

test("a normal body passes the consistency check", () => {
  assert.equal(checkConsistency(REALISTIC).ok, true);
});

test("consistency tolerates a genuinely thick waist", () => {
  // Waist can exceed hip on real builds; only an impossible gap should fire.
  assert.equal(checkConsistency({ ...REALISTIC, waist: 100, hip: 96 }).ok, true);
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


test("wearing ease follows the tailor's sheet, per measurement", () => {
  // The sheet writes body/with-ease as "18/19", "37/40", "38/39" — the
  // allowance differs by measurement, so it is tabulated rather than
  // computed from a single blanket figure.
  assert.ok(Math.abs((EASE_CM.shoulder_width ?? 0) - 1 * 2.54) < 1e-9);
  assert.ok(Math.abs((EASE_CM.chest_circumference ?? 0) - 3 * 2.54) < 1e-9);
  assert.ok(Math.abs((EASE_CM.waist ?? 0) - 1 * 2.54) < 1e-9);
});

test("no ease is invented where the sheet records none", () => {
  // Hip has no tight/ease pair on the sheet, so the app must show the body
  // figure alone rather than a garment figure it cannot justify.
  assert.equal(EASE_CM.hip, undefined);
  assert.equal(EASE_CM.hip_width, undefined);
});


/** World landmarks for a torso turned `deg` from square. */
function turned(deg: number) {
  const lm = Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0 }));
  const rad = (deg * Math.PI) / 180;
  for (const [left, right, half] of [
    [11, 12, 0.16],
    [23, 24, 0.1],
  ] as const) {
    lm[left] = { x: half * Math.cos(rad), y: 0, z: half * Math.sin(rad) };
    lm[right] = { x: -half * Math.cos(rad), y: 0, z: -half * Math.sin(rad) };
  }
  return lm;
}

test("a square stance reads as square", () => {
  const r = torsoRotation(turned(0));
  assert.ok(r);
  assert.ok(r.worstDeg < 1e-6);
  assert.equal(checkSquareness(turned(0)).ok, true);
});

test("rotation is measured from the depth between the shoulders", () => {
  for (const deg of [10, 25, 40]) {
    const r = torsoRotation(turned(deg));
    assert.ok(r && Math.abs(r.worstDeg - deg) < 1e-6, `${deg}° read back wrong`);
  }
});

test("the field failure a card check cannot see is caught here", () => {
  // Second photo of the same subject: card placed accurately, pose cross-check
  // in agreement, and every measurement 9-12% under the tailor's sheet. A
  // turned torso foreshortens the card-derived width and the pose estimate
  // alike, so comparing them cancels the error — only the depth between the
  // shoulders shows it.
  const report = checkSquareness(turned(25));
  assert.equal(report.ok, false);
  assert.ok(
    Math.abs(report.shortfall - (1 - Math.cos((25 * Math.PI) / 180))) < 1e-9,
  );
  assert.match(report.message ?? "", /9% short/);
  assert.match(report.message ?? "", /shortens both/);
});

test("a small lean is tolerated rather than nagged about", () => {
  // Nobody stands perfectly square, and a threshold that fires on 5° would
  // train people to ignore it.
  for (const deg of [0, 5, 10, 15]) {
    assert.equal(checkSquareness(turned(deg)).ok, true, `${deg}° should pass`);
  }
  assert.equal(checkSquareness(turned(16)).ok, false);
});

test("a twisted torso is caught by whichever half is worse", () => {
  const lm = turned(0);
  lm[23] = { x: 0.1 * Math.cos(0.6), y: 0, z: 0.1 * Math.sin(0.6) };
  lm[24] = { x: -0.1 * Math.cos(0.6), y: 0, z: -0.1 * Math.sin(0.6) };
  const r = torsoRotation(lm);
  assert.ok(r);
  assert.ok(r.shoulderDeg < 1e-6, "shoulders are square");
  assert.ok(Math.abs(r.hipDeg - (0.6 * 180) / Math.PI) < 1e-6);
  assert.equal(checkSquareness(lm).ok, false);
});

test("no world landmarks means no claim either way", () => {
  assert.equal(torsoRotation(undefined), null);
  assert.equal(checkSquareness(undefined).ok, true);
  assert.equal(checkSquareness(undefined).degrees, null);
});
