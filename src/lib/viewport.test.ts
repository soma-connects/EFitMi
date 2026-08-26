import test from "node:test";
import assert from "node:assert/strict";

import { scaleFor, toNatural, toScreen, type View } from "./viewport";
import type { PixelRect } from "./types";

const PHOTO = { width: 1280, height: 960 };
const VIEWPORT = { width: 358, height: 268 };
const CARD: PixelRect = { x: 600, y: 420, width: 64, height: 40 };

function roundTrip(view: View, rect: PixelRect): PixelRect {
  const scale = scaleFor(view, VIEWPORT, PHOTO);
  return toNatural(toScreen(rect, view, VIEWPORT, scale), view, VIEWPORT, scale);
}

test("photo -> screen -> photo is lossless at every zoom", () => {
  // If this drifted, zooming would silently change the measured card width
  // and therefore every measurement derived from it.
  for (const zoom of [1, 1.7, 3, 6.5, 12]) {
    const back = roundTrip({ zoom, cx: 640, cy: 480 }, CARD);
    for (const key of ["x", "y", "width", "height"] as const) {
      assert.ok(
        Math.abs(back[key] - CARD[key]) < 1e-9,
        `${key} drifted at zoom ${zoom}: ${back[key]} vs ${CARD[key]}`,
      );
    }
  }
});

test("panning does not change the box in photo space", () => {
  const a = roundTrip({ zoom: 4, cx: 400, cy: 300 }, CARD);
  const b = roundTrip({ zoom: 4, cx: 900, cy: 700 }, CARD);
  assert.ok(Math.abs(a.width - b.width) < 1e-9);
  assert.ok(Math.abs(a.x - b.x) < 1e-9);
});

test("the view centre lands at the viewport centre", () => {
  const view: View = { zoom: 3, cx: 640, cy: 480 };
  const scale = scaleFor(view, VIEWPORT, PHOTO);
  const point = toScreen({ x: 640, y: 480, width: 0, height: 0 }, view, VIEWPORT, scale);
  assert.ok(Math.abs(point.x - VIEWPORT.width / 2) < 1e-9);
  assert.ok(Math.abs(point.y - VIEWPORT.height / 2) < 1e-9);
});

test("zooming in makes the box bigger on screen but not in photo space", () => {
  const near = scaleFor({ zoom: 8, cx: 640, cy: 480 }, VIEWPORT, PHOTO);
  const far = scaleFor({ zoom: 2, cx: 640, cy: 480 }, VIEWPORT, PHOTO);
  assert.ok(near > far);

  const onScreenNear = toScreen(CARD, { zoom: 8, cx: 640, cy: 480 }, VIEWPORT, near);
  const onScreenFar = toScreen(CARD, { zoom: 2, cx: 640, cy: 480 }, VIEWPORT, far);
  assert.ok(onScreenNear.width > onScreenFar.width);

  // ...and the photo-space width, which is what gets measured, is unchanged.
  assert.ok(Math.abs(roundTrip({ zoom: 8, cx: 640, cy: 480 }, CARD).width - CARD.width) < 1e-9);
  assert.ok(Math.abs(roundTrip({ zoom: 2, cx: 640, cy: 480 }, CARD).width - CARD.width) < 1e-9);
});

test("scaleFor is safe before the viewport has been measured", () => {
  assert.equal(scaleFor({ zoom: 2, cx: 0, cy: 0 }, { width: 0, height: 0 }, PHOTO), 0);
});
