// Coordinate transforms between the photo's own pixel space and the
// on-screen viewport of the calibrate view.
//
// These matter for correctness, not just layout: the card box is stored in
// photo pixels (that's what the measurement divides by), but the user drags
// it in screen pixels. If the round trip through these functions were lossy,
// zooming or panning would quietly change the measured card width — and with
// it every measurement. The round trip is asserted in viewport.test.ts.

import type { PixelRect } from "./types";

export interface View {
  zoom: number;
  /** Photo-space point held at the centre of the viewport. */
  cx: number;
  cy: number;
}

export interface Size {
  width: number;
  height: number;
}

/** Screen pixels per photo pixel at the given view. */
export function scaleFor(view: View, viewport: Size, photo: Size): number {
  if (viewport.width === 0 || photo.width === 0) return 0;
  return (viewport.width / photo.width) * view.zoom;
}

export function toScreen(
  rect: PixelRect,
  view: View,
  viewport: Size,
  scale: number,
): PixelRect {
  return {
    x: (rect.x - view.cx) * scale + viewport.width / 2,
    y: (rect.y - view.cy) * scale + viewport.height / 2,
    width: rect.width * scale,
    height: rect.height * scale,
  };
}

export function toNatural(
  rect: PixelRect,
  view: View,
  viewport: Size,
  scale: number,
): PixelRect {
  return {
    x: (rect.x - viewport.width / 2) / scale + view.cx,
    y: (rect.y - viewport.height / 2) / scale + view.cy,
    width: rect.width / scale,
    height: rect.height / scale,
  };
}
