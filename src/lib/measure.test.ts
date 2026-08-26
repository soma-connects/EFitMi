// Run with `npm test` — Node's built-in runner with type stripping, so
// there's no test framework to install and no browser needed.
//
// These cover the arithmetic that decides whether a measurement is right.
// The contour scan only needs the `data`/`width`/`height` of an ImageData,
// so synthetic silhouettes stand in for photographs here.

import test from "node:test";
import assert from "node:assert/strict";

import { cmPerPixel, computeMeasurements, measure, refineWidth } from "./measure";
import { CARD_WIDTH_MM, LANDMARK } from "./constants";

const CARD_WIDTH_CM = CARD_WIDTH_MM / 10;

test("card measures itself back to its real width", () => {
  for (const px of [40, 100, 237.5, 800]) {
    assert.ok(Math.abs(px * cmPerPixel(px) - CARD_WIDTH_CM) < 1e-9);
  }
});

test("a card covering more pixels means each pixel is less distance", () => {
  assert.ok(cmPerPixel(200) < cmPerPixel(100));
});

test("refineWidth takes a contour reading that corroborates the landmarks", () => {
  assert.equal(refineWidth(100, 115), 115);
});

test("refineWidth rejects a contour reading the landmarks contradict", () => {
  // The reference project's max() let artefacts like these inflate results.
  assert.equal(refineWidth(100, 900), 100);
  assert.equal(refineWidth(100, 5), 100);
});

test("refineWidth falls back when the scan found nothing", () => {
  assert.equal(refineWidth(100, null), 100);
});

/** A bright rectangle on black, so the contour scan has real edges to find. */
function silhouette(width: number, height: number, bodyLeft: number, bodyRight: number) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const bright = x >= bodyLeft && x <= bodyRight ? 220 : 10;
      data[i] = data[i + 1] = data[i + 2] = bright;
      data[i + 3] = 255;
    }
  }
  return { data, width, height, colorSpace: "srgb" as const };
}

/** Landmarks placed as normalized fractions, as MediaPipe reports them. */
function landmarksFor(shoulderSpan: number) {
  const lm = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5 }));
  lm[LANDMARK.LEFT_SHOULDER] = { x: 0.5 + shoulderSpan / 2, y: 0.3 };
  lm[LANDMARK.RIGHT_SHOULDER] = { x: 0.5 - shoulderSpan / 2, y: 0.3 };
  lm[LANDMARK.LEFT_HIP] = { x: 0.56, y: 0.6 };
  lm[LANDMARK.RIGHT_HIP] = { x: 0.44, y: 0.6 };
  lm[LANDMARK.LEFT_KNEE] = { x: 0.55, y: 0.8 };
  lm[LANDMARK.RIGHT_KNEE] = { x: 0.45, y: 0.8 };
  return lm;
}

test("every measurement scales linearly with the card's pixel width", () => {
  // The regression that started this: hip mixed a contour reading in via
  // max(), so it alone did not scale with the calibration.
  const image = silhouette(400, 800, 120, 280);
  const landmarks = landmarksFor(0.3);

  const near = computeMeasurements(landmarks, image, 60);
  const far = computeMeasurements(landmarks, image, 120);

  for (const key of Object.keys(near) as Array<keyof typeof near>) {
    assert.ok(
      Math.abs(near[key] - far[key] * 2) < 0.02,
      `${key} did not halve when the card's pixel width doubled: ${near[key]} vs ${far[key]}`,
    );
  }
});

test("measurements are independent of image resolution", () => {
  // Downscaling shrinks card and body by the same factor, so the result
  // must not move.
  const landmarks = landmarksFor(0.3);
  const full = computeMeasurements(landmarks, silhouette(400, 800, 120, 280), 60);
  const half = computeMeasurements(landmarks, silhouette(200, 400, 60, 140), 30);

  assert.ok(Math.abs(full.shoulder_width - half.shoulder_width) < 0.02);
});

test("the same input always produces the same output", () => {
  const image = silhouette(400, 800, 120, 280);
  const landmarks = landmarksFor(0.3);
  const first = computeMeasurements(landmarks, image, 60);
  for (let i = 0; i < 3; i++) {
    assert.deepEqual(computeMeasurements(landmarks, image, 60), first);
  }
});

test("a wild contour reading cannot inflate a measurement", () => {
  // The reference project combined the landmark estimate and the contour
  // scan with max(), so a dark background, a shadow or a loose garment
  // could silently win and blow the number up. Here the "body" spans
  // nearly the whole frame while the landmarks describe a normal torso —
  // the landmarks must win.
  const landmarks = landmarksFor(0.22);
  const absurdlyWide = silhouette(1280, 960, 5, 1275);

  const shoulderPx = 0.22 * 1280;
  const cardPx = shoulderPx * (CARD_WIDTH_CM / 40) * 1.1;
  const scale = cmPerPixel(cardPx);

  const m = computeMeasurements(landmarks, absurdlyWide, cardPx);

  // With the contour rejected, hip falls back to the landmark span.
  const hipFromLandmarks = Math.abs(0.56 - 0.44) * 1280 * 1.35 * scale;
  assert.ok(
    Math.abs(m.hip_width - hipFromLandmarks) < 0.5,
    `hip should fall back to the landmark value ${hipFromLandmarks.toFixed(1)}, got ${m.hip_width}`,
  );

  // And the absurd reading must not have survived into the output at all.
  assert.ok(m.hip_width < 60, `implausible hip width from artefact: ${m.hip_width}`);
  assert.ok(m.chest_width < 70, `implausible chest width from artefact: ${m.chest_width}`);
});

test("a plausible photo gives plausible numbers", () => {
  // A 40cm-shouldered adult with the card spanning a proportionate width
  // should land in tape-measure territory, not at 5cm or 300cm.
  const image = silhouette(1280, 960, 500, 780);
  const landmarks = landmarksFor(0.22);
  const shoulderPx = 0.22 * 1280;
  const cardPx = shoulderPx * (CARD_WIDTH_CM / 40) * 1.1;

  const m = computeMeasurements(landmarks, image, cardPx);
  assert.ok(
    m.shoulder_width > 30 && m.shoulder_width < 55,
    `implausible shoulder width: ${m.shoulder_width}`,
  );
});

test("reported spans match the widths that were measured", () => {
  // The overlay is a debugging aid, so it has to show the real geometry —
  // a span that disagrees with its own measurement would mislead rather
  // than explain.
  const image = silhouette(1280, 960, 500, 780);
  const landmarks = landmarksFor(0.22);
  const cardPx = 0.22 * 1280 * (CARD_WIDTH_CM / 40) * 1.1;

  const { measurements, spans } = measure(landmarks, image, cardPx);
  const scale = cmPerPixel(cardPx);

  const byLabel = Object.fromEntries(spans.map((s) => [s.label, s]));
  const pairs: Array<[string, number]> = [
    ["Chest", measurements.chest_width],
    ["Waist", measurements.waist_width],
    ["Hip", measurements.hip_width],
  ];

  for (const [label, cm] of pairs) {
    const span = byLabel[label];
    assert.ok(span, `no span reported for ${label}`);
    const spanCm = Math.abs(span.x2 - span.x1) * 1280 * scale;
    assert.ok(
      Math.abs(spanCm - cm) < 0.05,
      `${label} span (${spanCm.toFixed(2)}cm) disagrees with its measurement (${cm}cm)`,
    );
  }
});

test("spans say whether the contour or the landmarks decided the width", () => {
  const landmarks = landmarksFor(0.22);
  const cardPx = 0.22 * 1280 * (CARD_WIDTH_CM / 40) * 1.1;

  // A frame-filling "body" is rejected, so every width falls to landmarks.
  const { spans } = measure(landmarks, silhouette(1280, 960, 5, 1275), cardPx);
  for (const span of spans) {
    assert.equal(span.source, "landmarks", `${span.label} should not trust that contour`);
  }
});

test("computeMeasurements still returns just the measurements", () => {
  const image = silhouette(400, 800, 120, 280);
  const landmarks = landmarksFor(0.3);
  assert.deepEqual(
    computeMeasurements(landmarks, image, 60),
    measure(landmarks, image, 60).measurements,
  );
});
