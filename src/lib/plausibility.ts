// Sanity bounds on the output. The phase 1 acceptance test is "is this
// number plausible against a tape measure" — so when a result lands outside
// the range a human body can occupy, the app should say so rather than
// present it as a measurement. Almost always the cause is the card box: too
// small a box inflates everything, too large deflates it.

import type { Measurements } from "./types";

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
