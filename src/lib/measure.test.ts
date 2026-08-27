// Run with `npm test` — Node's built-in runner with type stripping, so
// there's no test framework to install and no browser needed.
//
// These cover the arithmetic that decides whether a measurement is right.
// The contour scan only needs the `data`/`width`/`height` of an ImageData,
// so synthetic silhouettes stand in for photographs here.

import test from "node:test";
import assert from "node:assert/strict";

import {
  cmPerPixel,
  computeMeasurements,
  measure,
  refineWidth,
  shoulderWidthCm,
} from "./measure";
import { CARD_WIDTH_MM, CORRECTION, LANDMARK } from "./constants";

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
  const cardPx = shoulderPx * (CARD_WIDTH_CM / 40) * CORRECTION.SHOULDER;
  const scale = cmPerPixel(cardPx);

  const m = computeMeasurements(landmarks, absurdlyWide, cardPx);

  // With the contour rejected, hip falls back to the landmark span.
  const hipFromLandmarks =
    Math.abs(0.56 - 0.44) * 1280 * CORRECTION.HIP * scale;
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
  const cardPx = shoulderPx * (CARD_WIDTH_CM / 40) * CORRECTION.SHOULDER;

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
  const cardPx = 0.22 * 1280 * (CARD_WIDTH_CM / 40) * CORRECTION.SHOULDER;

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
  const cardPx = 0.22 * 1280 * (CARD_WIDTH_CM / 40) * CORRECTION.SHOULDER;

  // A frame-filling "body" is rejected, so every width falls to landmarks.
  const { spans } = measure(landmarks, silhouette(1280, 960, 5, 1275), cardPx);
  for (const span of spans) {
    assert.equal(span.source, "landmarks", `${span.label} should not trust that contour`);
  }
});

test("waist never takes a contour reading, even one the bound would accept", () => {
  // CORRECTION.WAIST is fitted to the hip-landmark baseline and carries the
  // whole span -> circumference ratio, so multiplying a contour reading of
  // the real torso by it double-counts. The +-50% bound has always rejected
  // the contour here in practice, but at 2.014 an accepted one would put the
  // waist near 57in, so waist is landmark-only by construction rather than
  // by luck.
  //
  // Both silhouettes sit inside the bound for waist's baseline (43.2px), so
  // the old code would have taken each contour and moved the number.
  const landmarks = landmarksFor(0.3);
  const narrow = computeMeasurements(landmarks, silhouette(400, 800, 180, 220), 60);
  const wide = computeMeasurements(landmarks, silhouette(400, 800, 175, 225), 60);

  assert.equal(
    narrow.waist_width,
    wide.waist_width,
    "waist moved with the silhouette, so a contour reading is still feeding it",
  );

  // The contrast that proves the silhouettes really do differ where the
  // contour is trusted: hip's baseline accepts both, so hip does move.
  assert.notEqual(narrow.hip_width, wide.hip_width);

  const waistSpan = measure(landmarks, silhouette(400, 800, 175, 225), 60).spans.find(
    (span) => span.label === "Waist",
  );
  assert.equal(waistSpan?.source, "landmarks");
});

/**
 * A torso mask that narrows to a waist partway down the frame. Its width is
 * a fraction of the mask, not a pixel count, so the same body can be rendered
 * at any resolution.
 */
function torsoMask(width: number, height: number) {
  const data = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const half = (0.2 - 0.075 * Math.sin(Math.PI * (y / height))) * width;
      data[y * width + x] = Math.abs(x - (width - 1) / 2) <= half ? 1 : 0;
    }
  }
  return { width, height, data };
}

test("the segmentation mask changes no reported measurement", () => {
  // The point of keeping it diagnostic. Every correction constant was fitted
  // against a landmark span, so feeding one a reading of the real body would
  // double-count — the same error that would have put the waist at 57in.
  const image = silhouette(400, 800, 120, 280);
  const landmarks = landmarksFor(0.3);

  const without = measure(landmarks, image, 60);
  const with_ = measure(landmarks, image, 60, torsoMask(400, 800));

  assert.deepEqual(with_.measurements, without.measurements);
  assert.equal(without.calibration, null);
  assert.ok(with_.calibration);
});

test("the readout reports the body, not the landmark span", () => {
  const image = silhouette(400, 800, 120, 280);
  const landmarks = landmarksFor(0.3);
  const { calibration } = measure(landmarks, image, 60, torsoMask(400, 800));
  assert.ok(calibration);

  // Landmark spans, uncorrected: shoulders 0.3 of 400px, hips 0.12 of 400px.
  const scale = cmPerPixel(60);
  assert.ok(Math.abs(calibration.shoulderJointSpanCm - 0.3 * 400 * scale) < 0.02);
  assert.ok(Math.abs(calibration.hipJointSpanCm - 0.12 * 400 * scale) < 0.02);

  // The mask is far wider than the hip joints are apart, which is the whole
  // reason a constant fitted to that span carries body proportions.
  assert.ok(calibration.waistBodyCm);
  assert.ok(calibration.waistBodyCm > calibration.hipJointSpanCm);
});

test("the readout says where the waist actually is", () => {
  // The shipped waist assumes 0.35 of the way from shoulders to hips and
  // lands on the lower ribs. This is the number that replaces that guess.
  const landmarks = landmarksFor(0.3);
  const { calibration } = measure(
    landmarks,
    silhouette(400, 800, 120, 280),
    60,
    torsoMask(400, 800),
  );
  assert.ok(calibration?.waistAtFraction);
  assert.notEqual(calibration.waistAtFraction, 0.35);
  assert.ok(
    calibration.waistAtFraction > 0.35 && calibration.waistAtFraction <= 0.8,
    `waist fraction ${calibration.waistAtFraction} escaped its search bounds`,
  );
});

test("a mask that finds no body costs a diagnostic, never a measurement", () => {
  const image = silhouette(400, 800, 120, 280);
  const landmarks = landmarksFor(0.3);
  const empty = { width: 400, height: 800, data: new Float32Array(400 * 800) };

  const { measurements, calibration } = measure(landmarks, image, 60, empty);
  assert.deepEqual(measurements, computeMeasurements(landmarks, image, 60));
  assert.equal(calibration?.chestBodyCm, null);
  assert.equal(calibration?.waistBodyCm, null);
  assert.equal(calibration?.waistAtFraction, null);
});

test("mask resolution does not change the readout", () => {
  // The mask need not match the photo's size, so the conversion back to image
  // pixels has to be right or every body figure is scaled by the ratio.
  const landmarks = landmarksFor(0.3);
  const image = silhouette(400, 800, 120, 280);
  const full = measure(landmarks, image, 60, torsoMask(400, 800)).calibration;
  const half = measure(landmarks, image, 60, torsoMask(200, 400)).calibration;
  assert.ok(full?.waistBodyCm && half?.waistBodyCm);
  assert.ok(
    Math.abs(full.waistBodyCm - half.waistBodyCm) < 0.5,
    `${full.waistBodyCm} vs ${half.waistBodyCm}`,
  );
});

test("computeMeasurements still returns just the measurements", () => {
  const image = silhouette(400, 800, 120, 280);
  const landmarks = landmarksFor(0.3);
  assert.deepEqual(
    computeMeasurements(landmarks, image, 60),
    measure(landmarks, image, 60).measurements,
  );
});


test("the calibrate preview equals the measurement it previews", () => {
  // A live readout that disagrees with the result it is previewing is worse
  // than none: it makes the user trust a box that produces something else.
  const image = silhouette(1280, 960, 500, 780);
  const landmarks = landmarksFor(0.22);

  for (const cardPx of [40, 66, 120, 300]) {
    const preview = shoulderWidthCm(landmarks, 1280, cardPx);
    const measured = computeMeasurements(landmarks, image, cardPx).shoulder_width;
    assert.ok(preview !== null);
    assert.ok(
      Math.abs((preview as number) - measured) < 0.01,
      `preview ${preview} != measured ${measured} at card ${cardPx}px`,
    );
  }
});

test("shoulderWidthCm refuses impossible inputs", () => {
  const landmarks = landmarksFor(0.22);
  assert.equal(shoulderWidthCm(landmarks, 1280, 0), null);
  assert.equal(shoulderWidthCm(landmarks, 1280, -5), null);
});
