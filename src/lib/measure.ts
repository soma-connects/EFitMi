// Client-side port of the measurement pipeline that previously lived in the
// Flask service (service/app.py, itself adapted from
// JavTahir/Live-Measurements-Api, MIT).
//
// Why it moved: the Python service's only irreplaceable part was the MiDaS
// depth refinement, and that has been inert in practice — without the
// downloaded weights every response came back with depth_refinement:false.
// Everything else it did (MediaPipe pose, the contour width scan, the
// elliptical circumference) the browser can do directly, and pose landmarks
// are already extracted here to gate the capture button. Running it in the
// browser makes the app a single static deploy with no backend to host.
//
// service/app.py is kept in the repo as the path back to depth refinement.
// If it is revived, keep the two implementations' geometry in sync.

import { CARD_WIDTH_MM, CORRECTION, LANDMARK } from "./constants";
import type { Measurements } from "./types";

const ROW_SAMPLE_COUNT = 9; // odd, so the median is an actual sampled row
const ROW_SAMPLE_SPREAD = 0.02; // fraction of image height to spread samples over
const EDGE_THRESHOLD = 50; // 0-255 luma below this counts as an edge
const BLUR_RADIUS = 2; // 5x5 window, matching the service's GaussianBlur

interface Landmark {
  x: number;
  y: number;
}

/** cm per pixel, from the card's known real-world width. */
export function cmPerPixel(cardBoxWidthPx: number): number {
  return CARD_WIDTH_MM / 10 / cardBoxWidthPx;
}

/**
 * Shoulder width for a given card box, in cm.
 *
 * The calibrate screen shows this live so the box can be sanity-checked
 * before it's committed, and computeMeasurements reports the same figure.
 * They must never disagree — a preview that doesn't match the result it
 * previews is worse than no preview — so both call this.
 */
export function shoulderWidthCm(
  landmarks: Landmark[],
  imageWidth: number,
  cardBoxWidthPx: number,
): number | null {
  const left = landmarks[LANDMARK.LEFT_SHOULDER];
  const right = landmarks[LANDMARK.RIGHT_SHOULDER];
  if (!left || !right || cardBoxWidthPx <= 0) return null;
  const spanPx = Math.abs(left.x - right.x) * imageWidth;
  if (spanPx <= 0) return null;
  return spanPx * CORRECTION.SHOULDER * cmPerPixel(cardBoxWidthPx);
}

/**
 * Prefer the contour reading, but only when it corroborates the pose
 * landmarks. The scan is threshold-based, so a shadow or a loose garment can
 * make it read almost anything; taking max() of the two (as the reference
 * project did) lets any such artefact silently inflate the result.
 */
export function refineWidth(
  landmarkWidthPx: number,
  detectedWidthPx: number | null,
  tolerance = 0.5,
): number {
  if (detectedWidthPx === null) return landmarkWidthPx;
  const lower = landmarkWidthPx * (1 - tolerance);
  const upper = landmarkWidthPx * (1 + tolerance);
  return detectedWidthPx >= lower && detectedWidthPx <= upper
    ? detectedWidthPx
    : landmarkWidthPx;
}

/** Greyscale luma plane, so the row scans don't redo the RGBA maths. */
function toGreyscale(image: ImageData): Uint8ClampedArray {
  const { data, width, height } = image;
  const grey = new Uint8ClampedArray(width * height);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    grey[p] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  }
  return grey;
}

/** Blurred luma at one pixel, averaged over a 5x5 window. */
function blurredAt(
  grey: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
): number {
  let sum = 0;
  let count = 0;
  for (let dy = -BLUR_RADIUS; dy <= BLUR_RADIUS; dy++) {
    const yy = y + dy;
    if (yy < 0 || yy >= height) continue;
    for (let dx = -BLUR_RADIUS; dx <= BLUR_RADIUS; dx++) {
      const xx = x + dx;
      if (xx < 0 || xx >= width) continue;
      sum += grey[yy * width + xx];
      count++;
    }
  }
  return sum / count;
}

/** Width at one scanned row, or null if either edge was never found. */
function scanRowWidth(
  grey: Uint8ClampedArray,
  width: number,
  height: number,
  row: number,
  centerPx: number,
): number | null {
  let leftEdge: number | null = null;
  let rightEdge: number | null = null;

  for (let x = centerPx; x > 0; x--) {
    if (blurredAt(grey, width, height, x, row) <= EDGE_THRESHOLD) {
      leftEdge = x;
      break;
    }
  }
  for (let x = centerPx; x < width; x++) {
    if (blurredAt(grey, width, height, x, row) <= EDGE_THRESHOLD) {
      rightEdge = x;
      break;
    }
  }

  if (leftEdge === null || rightEdge === null) return null;
  return rightEdge - leftEdge;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

/**
 * Body width in pixels at a given height, or null if it can't be found.
 * A single scanline is far too sensitive to exactly which row it lands on, so
 * this samples a band of rows and takes the median.
 */
function getBodyWidthAtHeight(
  grey: Uint8ClampedArray,
  width: number,
  height: number,
  heightPx: number,
  centerXNorm: number,
): number | null {
  const centerPx = Math.round(
    Math.min(Math.max(centerXNorm * width, 1), width - 2),
  );
  const spreadPx = Math.max(1, Math.round(height * ROW_SAMPLE_SPREAD));
  const step = (spreadPx * 2) / (ROW_SAMPLE_COUNT - 1);

  const widths: number[] = [];
  for (let i = 0; i < ROW_SAMPLE_COUNT; i++) {
    const row = Math.round(
      Math.min(Math.max(heightPx - spreadPx + i * step, 0), height - 1),
    );
    const w = scanRowWidth(grey, width, height, row, centerPx);
    if (w !== null && w > 0) widths.push(w);
  }

  return widths.length ? median(widths) : null;
}

/**
 * Where each width was actually taken, in normalized photo coordinates, and
 * whether the contour scan or the pose landmarks won.
 *
 * This is what makes the result inspectable: seeing that the "waist" line
 * landed on a jacket hem, or that the contour grabbed a doorframe, explains
 * a wrong number in a way the number alone never can.
 */
export interface MeasuredSpan {
  label: string;
  /** Normalized y of the scanned row. */
  y: number;
  /** Normalized x of each end of the measured width. */
  x1: number;
  x2: number;
  source: "contour" | "landmarks";
}

export interface MeasurementResult {
  measurements: Measurements;
  spans: MeasuredSpan[];
}

export function computeMeasurements(
  landmarks: Landmark[],
  image: ImageData,
  cardBoxWidthPx: number,
): Measurements {
  return measure(landmarks, image, cardBoxWidthPx).measurements;
}

export function measure(
  landmarks: Landmark[],
  image: ImageData,
  cardBoxWidthPx: number,
): MeasurementResult {
  const { width, height } = image;
  const scale = cmPerPixel(cardBoxWidthPx);
  const grey = toGreyscale(image);

  const toCm = (px: number) => Math.round(px * scale * 100) / 100;

  // Elliptical approximation: C ~= 2*pi*sqrt((a^2 + b^2) / 2). depthRatio is
  // fixed at 1.0 — it existed only to carry the MiDaS adjustment, which is
  // not available client-side (and was inert server-side in practice).
  const circumference = (widthPx: number, depthRatio = 1.0) => {
    const widthCm = widthPx * scale;
    const depthCm = widthCm * depthRatio * 0.7;
    const halfWidth = widthCm / 2;
    const halfDepth = depthCm / 2;
    const c =
      2 * Math.PI * Math.sqrt((halfWidth ** 2 + halfDepth ** 2) / 2);
    return Math.round(c * 100) / 100;
  };

  const leftShoulder = landmarks[LANDMARK.LEFT_SHOULDER];
  const rightShoulder = landmarks[LANDMARK.RIGHT_SHOULDER];
  const leftHip = landmarks[LANDMARK.LEFT_HIP];
  const rightHip = landmarks[LANDMARK.RIGHT_HIP];
  const leftKnee = landmarks[LANDMARK.LEFT_KNEE];

  // Shoulder width — pure landmark distance, no contour involvement.
  // Expressed in pixels here, but it is the same quantity shoulderWidthCm()
  // reports on the calibrate screen; the shared helper keeps them identical.
  const shoulderWidthPx =
    Math.abs(leftShoulder.x * width - rightShoulder.x * width) *
    CORRECTION.SHOULDER;

  const spans: MeasuredSpan[] = [];

  /** Records where a width was taken, centred on the scan's centre point. */
  const record = (
    label: string,
    yNorm: number,
    centerXNorm: number,
    widthPx: number,
    detected: number | null,
    chosen: number,
  ) => {
    const half = widthPx / 2 / width;
    spans.push({
      label,
      y: yNorm,
      x1: centerXNorm - half,
      x2: centerXNorm + half,
      source: detected !== null && detected === chosen ? "contour" : "landmarks",
    });
  };

  spans.push({
    label: "Shoulder",
    y: (leftShoulder.y + rightShoulder.y) / 2,
    x1: Math.min(leftShoulder.x, rightShoulder.x),
    x2: Math.max(leftShoulder.x, rightShoulder.x),
    source: "landmarks",
  });

  // Chest.
  const chestY = leftShoulder.y + (leftHip.y - leftShoulder.y) * 0.15;
  const chestCenterX = (leftShoulder.x + rightShoulder.x) / 2;
  const chestLandmarkPx =
    Math.abs((rightShoulder.x - leftShoulder.x) * width) * CORRECTION.CHEST;
  const chestDetected = getBodyWidthAtHeight(
    grey, width, height, chestY * height, chestCenterX,
  );
  const chestWidthPx = refineWidth(chestLandmarkPx, chestDetected);
  record("Chest", chestY, chestCenterX, chestWidthPx, chestDetected, chestWidthPx);

  // Waist. Three separate problems stack here, and only the last is a
  // constant — so do not expect a tape measurement alone to fix it:
  //
  //   1. This line sits 35% of the way from the shoulder joints to the hip
  //      joints, which lands around the lower ribs — above the natural
  //      waist, and far above a trouser waistband.
  //   2. Its baseline is the HIP landmark span, not the torso at this
  //      height, so it is ~0.77x hip by construction whatever the body does.
  //   3. CORRECTION.WAIST is inherited and unvalidated.
  //
  // Fixing it properly means moving the measurement point down and giving it
  // a baseline of its own, then calibrating against a natural-waist tape
  // measurement taken on bare torso — not a trouser waist over clothing.
  const waistY = leftShoulder.y + (leftHip.y - leftShoulder.y) * 0.35;
  const hipCenterX = (leftHip.x + rightHip.x) / 2;
  const waistLandmarkPx = Math.abs(rightHip.x - leftHip.x) * width * 0.9;
  const waistDetected = getBodyWidthAtHeight(
    grey, width, height, waistY * height, hipCenterX,
  );
  const waistRefined = refineWidth(waistLandmarkPx, waistDetected);
  const waistWidthPx = waistRefined * CORRECTION.WAIST;
  record("Waist", waistY, hipCenterX, waistWidthPx, waistDetected, waistRefined);

  // Hip.
  const hipY = leftHip.y + (leftKnee.y - leftHip.y) * 0.1;
  const hipLandmarkPx =
    Math.abs(leftHip.x * width - rightHip.x * width) * CORRECTION.HIP;
  const hipDetected = getBodyWidthAtHeight(
    grey, width, height, hipY * height, hipCenterX,
  );
  const hipWidthPx = refineWidth(hipLandmarkPx, hipDetected);
  record("Hip", hipY, hipCenterX, hipWidthPx, hipDetected, hipWidthPx);

  return {
    measurements: {
      shoulder_width: toCm(shoulderWidthPx),
      chest_width: toCm(chestWidthPx),
      chest_circumference: circumference(chestWidthPx),
      waist_width: toCm(waistWidthPx),
      waist: circumference(waistWidthPx),
      hip_width: toCm(hipWidthPx),
      hip: circumference(hipWidthPx),
    },
    spans,
  };
}
