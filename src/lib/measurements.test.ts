import test from "node:test";
import assert from "node:assert/strict";
import type { NormalizedLandmark } from "@mediapipe/tasks-vision";

import { checkFraming } from "./measurements";

/** A well-framed person: centred, fully visible, square to the camera. */
function framed(): NormalizedLandmark[] {
  const lm = Array.from({ length: 33 }, () => ({
    x: 0.5,
    y: 0.5,
    z: 0,
    visibility: 0.9,
  }));
  lm[11] = { x: 0.62, y: 0.3, z: 0, visibility: 0.9 };
  lm[12] = { x: 0.38, y: 0.3, z: 0, visibility: 0.9 };
  lm[23] = { x: 0.56, y: 0.6, z: 0, visibility: 0.9 };
  lm[24] = { x: 0.44, y: 0.6, z: 0, visibility: 0.9 };
  return lm;
}

/** World landmarks for a torso turned `deg` from square. */
function turned(deg: number): NormalizedLandmark[] {
  const rad = (deg * Math.PI) / 180;
  const lm = Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0, visibility: 0.9 }));
  for (const [left, right, half] of [
    [11, 12, 0.16],
    [23, 24, 0.1],
  ] as const) {
    lm[left] = { x: half * Math.cos(rad), y: 0, z: half * Math.sin(rad), visibility: 0.9 };
    lm[right] = { x: -half * Math.cos(rad), y: 0, z: -half * Math.sin(rad), visibility: 0.9 };
  }
  return lm;
}

test("a good frame is allowed through", () => {
  assert.equal(checkFraming(framed(), 120, turned(0)).ok, true);
});

test("a turned torso is refused at capture, not diagnosed afterwards", () => {
  // The failure this gate exists for: every width is foreshortened by cos of
  // the angle, and nothing downstream can see it — the card is measured
  // correctly and the pose cross-check agrees, because a rotation shortens
  // both estimates together. By the results screen the only fix left is
  // retaking, so the shot has to be refused while the person is still there.
  const result = checkFraming(framed(), 120, turned(25));
  assert.equal(result.ok, false);
  assert.ok(result.reasons.some((r) => /squarely/.test(r)), result.reasons.join("; "));
});

test("the gate still passes when the pose model gives no 3D estimate", () => {
  // Squareness is unknowable without world landmarks, and refusing every shot
  // on a device that doesn't produce them would make the app unusable.
  assert.equal(checkFraming(framed(), 120).ok, true);
  assert.equal(checkFraming(framed(), 120, null).ok, true);
});

test("the existing framing rules still apply", () => {
  assert.deepEqual(checkFraming(null, 120).reasons, [
    "No person detected — step into frame",
  ]);
  assert.ok(checkFraming(framed(), 10).reasons.some((r) => /dark/.test(r)));

  const offCentre = framed();
  offCentre[11] = { ...offCentre[11], x: 0.92 };
  offCentre[12] = { ...offCentre[12], x: 0.68 };
  assert.ok(checkFraming(offCentre, 120).reasons.some((r) => /center/.test(r)));
});
