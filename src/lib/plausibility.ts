// Sanity bounds on the output. The phase 1 acceptance test is "is this
// number plausible against a tape measure" — so when a result lands outside
// the range a human body can occupy, the app should say so rather than
// present it as a measurement. Almost always the cause is the card box: too
// small a box inflates everything, too large deflates it.

import { CORRECTION } from "./constants";
import type { Measurements } from "./types";

const SHOULDER_CORRECTION = CORRECTION.SHOULDER;

interface Bound {
  key: keyof Measurements;
  label: string;
  min: number;
  max: number;
}

// Generous adult ranges in cm — deliberately wide, to catch the broken cases
// (a 5cm or 300cm shoulder) without second-guessing real human variation.
const BOUNDS: Bound[] = [
  { key: "shoulder_width", label: "Shoulder width", min: 25, max: 65 },
  { key: "chest_width", label: "Chest width", min: 20, max: 70 },
  { key: "chest_circumference", label: "Chest", min: 60, max: 160 },
  { key: "waist_width", label: "Waist width", min: 15, max: 70 },
  { key: "waist", label: "Waist", min: 45, max: 160 },
  { key: "hip_width", label: "Hip width", min: 18, max: 70 },
  { key: "hip", label: "Hip", min: 55, max: 170 },
];

// A scale error moves every measurement by the same factor, so one reliable
// value is enough to detect it — and shoulder width is the most reliable one
// here: pure landmark distance, no contour scan, no structural fudge. These
// are typical adult ranges, deliberately narrower than the "impossible"
// bounds above, because a 31cm shoulder is not impossible, it's just almost
// certainly a mis-scaled adult.
const TYPICAL_SHOULDER_MIN_CM = 36;
const TYPICAL_SHOULDER_MAX_CM = 52;

export interface ScaleReport {
  ok: boolean;
  direction: "small" | "large" | null;
  message: string | null;
  /** MediaPipe's own shoulder estimate in cm, when it was available. */
  crossCheckCm?: number;
}

/**
 * Shoulder width in cm from MediaPipe's 3D world landmarks.
 *
 * These are in metres and independent of the card entirely, which is what
 * makes them useful here — but they come from the model's body prior rather
 * than from this person's photo, so they are a second opinion, never the
 * measurement. Using them as the answer would be the assumed-scale mistake
 * the card exists to avoid.
 */
export function worldShoulderCm(
  worldLandmarks: Array<{ x: number; y: number; z?: number }> | undefined,
): number | null {
  if (!worldLandmarks || worldLandmarks.length < 13) return null;
  const l = worldLandmarks[11];
  const r = worldLandmarks[12];
  if (!l || !r) return null;
  const dx = l.x - r.x;
  const dy = l.y - r.y;
  const dz = (l.z ?? 0) - (r.z ?? 0);
  const metres = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (!Number.isFinite(metres) || metres <= 0) return null;
  return metres * 100;
}

/**
 * How far the card-derived scale may drift from the cross-check before it's
 * suspect.
 *
 * Tightened from 0.25 once a tape measurement showed the pose path is good
 * to ~2% on a real subject. At 0.25 it stayed silent on a run that was 12%
 * out, which is the error that matters — large enough to ruin a garment,
 * small enough to look believable.
 */
const CROSS_CHECK_TOLERANCE = 0.12;

/**
 * Compares the card-derived shoulder width against MediaPipe's independent
 * 3D estimate. This catches a mis-scaled result whatever caused it, and
 * unlike a fixed range it adapts to the actual person — a genuinely
 * narrow-shouldered adult will read narrow in both.
 */
export function checkAgainstPose(
  m: Measurements,
  worldLandmarks: Array<{ x: number; y: number; z?: number }> | undefined,
): ScaleReport {
  const joints = worldShoulderCm(worldLandmarks);
  if (joints === null) return checkScale(m);

  // Compare like with like. The world landmarks sit at the shoulder joint
  // centres, inboard of the acromion, whereas shoulder_width applies
  // CORRECTION.SHOULDER to approximate the across-the-shoulders measurement a
  // tailor would take. Without applying the same factor here the check reads
  // ~10% low on every body and cries wolf.
  const expected = joints * SHOULDER_CORRECTION;

  const measured = m.shoulder_width;
  const ratio = measured / expected;

  if (Math.abs(ratio - 1) <= CROSS_CHECK_TOLERANCE) {
    return { ok: true, direction: null, message: null, crossCheckCm: expected };
  }

  const factor = expected / measured;
  const tooSmall = ratio < 1;

  return {
    ok: false,
    direction: tooSmall ? "small" : "large",
    crossCheckCm: expected,
    message: tooSmall
      ? `The pose model puts your shoulders near ${expected.toFixed(0)}cm, but the card scale ` +
        `makes them ${measured.toFixed(0)}cm — everything here is about ${factor.toFixed(1)}x too small. ` +
        `That happens when the card sits closer to the camera than your body: held out in ` +
        `your hands it covers more pixels than its real size, and the effect gets far worse ` +
        `the closer you are. Press the card flat against your chest, prop the phone up, and ` +
        `stand back a couple of metres.`
      : `The pose model puts your shoulders near ${expected.toFixed(0)}cm, but the card scale ` +
        `makes them ${measured.toFixed(0)}cm — everything here is about ${(1 / factor).toFixed(1)}x too large. ` +
        `The card box is probably narrower than the card, or the card was tilted away from ` +
        `the camera.`,
  };
}

/**
 * Detects the failure this app is most prone to: a card box that doesn't
 * match the card's true apparent size, which rescales every result at once.
 *
 * The most common cause isn't a sloppy drag — it's holding the card away
 * from the body. A card out in front of the chest is closer to the camera
 * than the shoulders are, so it covers more pixels than its real-world size
 * warrants, and everything measured against it comes out too small.
 */
export function checkScale(m: Measurements): ScaleReport {
  const shoulder = m.shoulder_width;

  if (shoulder < TYPICAL_SHOULDER_MIN_CM) {
    return {
      ok: false,
      direction: "small",
      message:
        `A ${shoulder.toFixed(0)}cm shoulder width is narrow for an adult, and ` +
        `everything else here is scaled to match — so the card box was probably ` +
        `wider than the card really is. The usual cause is holding the card out ` +
        `in front of you: that puts it closer to the camera than your shoulders, ` +
        `so it looks bigger than it is. Press it flat against your chest and ` +
        `retake, or tighten the box onto the card's edges.`,
    };
  }

  if (shoulder > TYPICAL_SHOULDER_MAX_CM) {
    return {
      ok: false,
      direction: "large",
      message:
        `A ${shoulder.toFixed(0)}cm shoulder width is broad for an adult, and ` +
        `everything else here is scaled to match — so the card box was probably ` +
        `smaller than the card really is. Go back and widen it onto the card's ` +
        `edges.`,
    };
  }

  return { ok: true, direction: null, message: null };
}

export type Verdict = "ok" | "low" | "high";

export function verdictFor(key: keyof Measurements, value: number): Verdict {
  const bound = BOUNDS.find((b) => b.key === key);
  if (!bound) return "ok";
  if (value < bound.min) return "low";
  if (value > bound.max) return "high";
  return "ok";
}

export interface PlausibilityReport {
  ok: boolean;
  /** Direction most out-of-range values point, for a targeted hint. */
  skew: "low" | "high" | "mixed" | null;
  message: string | null;
}

export function checkPlausibility(m: Measurements): PlausibilityReport {
  const verdicts = BOUNDS.map((b) => verdictFor(b.key, m[b.key])).filter(
    (v) => v !== "ok",
  );

  if (verdicts.length === 0) {
    return { ok: true, skew: null, message: null };
  }

  const allHigh = verdicts.every((v) => v === "high");
  const allLow = verdicts.every((v) => v === "low");
  const skew = allHigh ? "high" : allLow ? "low" : "mixed";

  const message =
    skew === "high"
      ? "These readings are too large to be a real body. The card box was probably drawn smaller than the actual card — go back and make it match the card's edges exactly."
      : skew === "low"
        ? "These readings are too small to be a real body. The card box was probably drawn larger than the actual card — go back and tighten it onto the card's edges."
        : "These readings don't look like a real body. Check that the box outlined the card exactly, and that you were square to the camera.";

  return { ok: false, skew, message };
}
