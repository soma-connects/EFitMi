import test from "node:test";
import assert from "node:assert/strict";

import { bodyWidthAt, findWaist, torsoRun, type Silhouette } from "./silhouette";

/** Builds a mask from a per-row predicate. */
function mask(
  width: number,
  height: number,
  inBody: (x: number, y: number) => boolean,
): Silhouette {
  const data = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      data[y * width + x] = inBody(x, y) ? 1 : 0;
    }
  }
  return { width, height, data };
}

/** A column of body `bodyWidth` px wide, centred. */
function column(width: number, height: number, bodyWidth: number): Silhouette {
  const half = bodyWidth / 2;
  return mask(width, height, (x) =>
    Math.abs(x - (width - 1) / 2) <= half - 0.5,
  );
}

test("body width reads back the silhouette's actual width", () => {
  const s = column(400, 800, 120);
  const w = bodyWidthAt(s, 0.5, 0.5);
  assert.ok(w);
  assert.equal(w.widthPx, 120);
});

test("width is found whether the body is lighter or darker than the room", () => {
  // The failure that motivated this file: the old scan searched for absolute
  // darkness, so it only worked on a bright body against a black background.
  // A mask carries no brightness at all, so both cases are the same input.
  const s = column(400, 800, 120);
  assert.equal(bodyWidthAt(s, 0.5, 0.5)?.widthPx, 120);
});

test("the reported span is the width that was measured", () => {
  const s = column(400, 800, 120);
  const w = bodyWidthAt(s, 0.5, 0.5);
  assert.ok(w);
  assert.ok(Math.abs((w.x2 - w.x1) * 400 - w.widthPx) < 1e-6);
});

test("arms held away from the body are not measured as torso", () => {
  // The whole reason for taking the run containing the centre rather than the
  // row's extent. Torso 120px, a 20px gap either side, then a 30px arm.
  const s = mask(400, 800, (x) => {
    const d = Math.abs(x - 199.5);
    return d <= 59.5 || (d >= 80 && d <= 110);
  });
  const w = bodyWidthAt(s, 0.5, 0.5);
  assert.ok(w);
  assert.equal(w.widthPx, 120, "the arms were counted as part of the torso");
});

test("arms touching the body cannot be separated, and that is visible", () => {
  // Honest limit: with no gap there is nothing in the mask to cut on, so the
  // reading is torso+arms. This is why the capture pose matters.
  const s = column(400, 800, 200);
  assert.equal(bodyWidthAt(s, 0.5, 0.5)?.widthPx, 200);
});

test("a speck of noise inside the torso does not truncate it", () => {
  // A dark fold, a printed logo, or mask noise puts stray background pixels
  // inside the silhouette. One pixel must not become the edge of the body.
  const s = mask(400, 800, (x) => {
    if (x === 170 || x === 230) return false; // holes inside the torso
    return Math.abs(x - 199.5) <= 59.5;
  });
  assert.equal(bodyWidthAt(s, 0.5, 0.5)?.widthPx, 120);
});

test("a centre that lands just off the body still finds it", () => {
  // Between the legs, or beside a torso turned slightly from the camera.
  const s = mask(400, 800, (x) => x >= 250 && x <= 330);
  const w = bodyWidthAt(s, 0.5, 0.6); // 240px, ten short of the body
  assert.ok(w, "gave up instead of looking outward for the body");
  assert.equal(w.widthPx, 81);
});

test("a centre nowhere near the body reports nothing", () => {
  // The search outward is deliberately bounded. Reaching across the frame for
  // any body pixel would find an arm, or a second person, and call it a
  // torso — a wrong number where null is the honest answer.
  const s = mask(400, 800, (x) => x >= 250 && x <= 330);
  assert.equal(bodyWidthAt(s, 0.5, 0.1), null);
});

test("a row with no body at all reports nothing rather than a number", () => {
  // The old scan returned 10% of the image width when it found no edge, which
  // could be presented as a measurement.
  const s = mask(400, 800, (_x, y) => y < 100);
  assert.equal(bodyWidthAt(s, 0.9, 0.5), null);
  assert.equal(torsoRun(s, 700, 200), null);
});

test("width is independent of mask resolution", () => {
  const full = bodyWidthAt(column(400, 800, 120), 0.5, 0.5);
  const half = bodyWidthAt(column(200, 400, 60), 0.5, 0.5);
  assert.ok(full && half);
  assert.ok(Math.abs(full.widthPx / 400 - half.widthPx / 200) < 0.005);
});

/**
 * A torso that narrows to a waist and widens again — ribs at the top, waist
 * at 55% of the way down, hips below.
 */
function torso(width: number, height: number): Silhouette {
  return mask(width, height, (x, y) => {
    const t = y / height;
    const halfWidth = 60 - 25 * Math.sin(Math.PI * Math.min(Math.max(t, 0), 1));
    return Math.abs(x - (width - 1) / 2) <= halfWidth;
  });
}

test("the waist is found at the narrowest point, not at a fixed fraction", () => {
  // The fix for the measurement point: 35% of the way from shoulders to hips
  // landed on the lower ribs of one subject, so the constant had to force a
  // rib reading up to a waist figure. Searching for the minimum locates the
  // waist on whatever body is in front of the camera.
  const s = torso(400, 800);
  const waist = findWaist(s, 0.1, 0.9, 0.5);
  assert.ok(waist);
  assert.ok(
    Math.abs(waist.y - 0.5) < 0.06,
    `waist found at ${waist.y.toFixed(3)}, expected the narrowest point near 0.5`,
  );

  // And it must actually be narrower than the fixed fraction it replaces.
  const atOldPoint = bodyWidthAt(s, 0.35, 0.5);
  assert.ok(atOldPoint && waist.widthPx < atOldPoint.widthPx);
});

test("the waist search respects its bounds", () => {
  const s = torso(400, 800);
  const waist = findWaist(s, 0.1, 0.3, 0.5);
  assert.ok(waist);
  assert.ok(waist.y <= 0.3 + 1e-9 && waist.y >= 0.1 - 1e-9);
});

test("the waist search reports nothing when the mask has no body", () => {
  const empty = mask(400, 800, () => false);
  assert.equal(findWaist(empty, 0.1, 0.9, 0.5), null);
  assert.equal(findWaist(torso(400, 800), 0.9, 0.1, 0.5), null);
});
