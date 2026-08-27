// Body width from MediaPipe's segmentation mask.
//
// This exists because the inherited contour scan (measure.ts, scanRowWidth)
// never worked outside a studio. It walks outward from the body centre until
// it hits a pixel darker than luma 50, so it only finds an edge when the
// subject is bright against a near-black background. In a real room it either
// stops on the first pixel (dark clothing) or never stops (light wall), and
// the ±50% corroboration bound then discards the result. Measured across five
// lighting arrangements it contributed to exactly one: the synthetic fixture
// in the test suite.
//
// The consequence was that no measurement in this app has ever been a
// measurement of the body. Every one is a pose landmark span multiplied by a
// constant fitted to one subject, which is why those constants had to absorb
// whole-body proportions rather than just a measurement convention.
//
// PoseLandmarker can emit a person/background segmentation mask alongside the
// landmarks, which is the thing the contour scan was approximating badly. It
// costs no extra model and no extra download.

/** A person/background mask: confidence in 0..1, row-major. */
export interface Silhouette {
  width: number;
  height: number;
  data: Float32Array;
}

/** Confidence above which a pixel counts as body. */
const BODY_THRESHOLD = 0.5;

/** Rows sampled around the target height; odd, so the median is a real row. */
const ROW_SAMPLE_COUNT = 9;

/** Fraction of image height the sampled rows are spread over. */
const ROW_SAMPLE_SPREAD = 0.02;

/**
 * Background pixels needed to count as the edge of the torso, as a fraction
 * of image width.
 *
 * A single stray background pixel inside the silhouette — mask noise, a dark
 * fold, a printed logo — would otherwise truncate the torso at that point. A
 * real gap between an arm and the ribs is far wider than the noise.
 */
const EDGE_GAP_FRACTION = 0.004;

/** How far off-centre to look for the body, as a fraction of image width. */
const CENTRE_SEARCH_FRACTION = 0.15;

/** A row must be usable in at least this fraction of samples to be trusted. */
const MIN_USABLE_ROWS = 0.5;

export interface RowSpan {
  /** Inclusive pixel columns of the run containing the centre. */
  left: number;
  right: number;
}

function isBody(s: Silhouette, x: number, y: number): boolean {
  return s.data[y * s.width + x] >= BODY_THRESHOLD;
}

/**
 * The run of body pixels containing (or nearest to) `centrePx` on one row.
 *
 * Returns the *run*, not the outermost body pixels on the row. That is what
 * separates the torso from the arms: with the arms held away from the body
 * there is a background gap either side of the ribs, and the run stops there.
 * Taking the row's full extent instead would measure shoulder-to-fingertip.
 */
export function torsoRun(
  s: Silhouette,
  row: number,
  centrePx: number,
): RowSpan | null {
  if (row < 0 || row >= s.height) return null;

  const gap = Math.max(2, Math.round(s.width * EDGE_GAP_FRACTION));
  const search = Math.max(1, Math.round(s.width * CENTRE_SEARCH_FRACTION));

  // The pose centre can sit just off the body — between the legs, or beside a
  // turned torso — so look outward a little for a starting foothold.
  let start: number | null = null;
  for (let d = 0; d <= search; d++) {
    for (const x of d === 0 ? [centrePx] : [centrePx - d, centrePx + d]) {
      if (x >= 0 && x < s.width && isBody(s, x, row)) {
        start = x;
        break;
      }
    }
    if (start !== null) break;
  }
  if (start === null) return null;

  /** Walks out from `start` until `gap` consecutive background pixels. */
  const edge = (step: -1 | 1): number => {
    let last = start;
    let run = 0;
    for (let x = start + step; x >= 0 && x < s.width; x += step) {
      if (isBody(s, x, row)) {
        last = x;
        run = 0;
      } else if (++run >= gap) {
        break;
      }
    }
    return last;
  };

  return { left: edge(-1), right: edge(1) };
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

export interface BodyWidth {
  widthPx: number;
  /** Normalized x of each edge, for drawing the span that was measured. */
  x1: number;
  x2: number;
}

/**
 * Torso width at a normalized height, in mask pixels.
 *
 * A single scanline is far too sensitive to exactly which row it lands on, so
 * this samples a band and takes the median — the same reasoning as the scan
 * it replaces, applied to a source that actually finds the body.
 */
export function bodyWidthAt(
  s: Silhouette,
  yNorm: number,
  centreXNorm: number,
): BodyWidth | null {
  if (s.width <= 0 || s.height <= 0) return null;

  const centrePx = Math.min(
    Math.max(Math.round(centreXNorm * s.width), 0),
    s.width - 1,
  );
  const spreadPx = Math.max(1, Math.round(s.height * ROW_SAMPLE_SPREAD));
  const step = (spreadPx * 2) / (ROW_SAMPLE_COUNT - 1);
  const centreRow = yNorm * s.height;

  const runs: RowSpan[] = [];
  for (let i = 0; i < ROW_SAMPLE_COUNT; i++) {
    const row = Math.round(
      Math.min(Math.max(centreRow - spreadPx + i * step, 0), s.height - 1),
    );
    const run = torsoRun(s, row, centrePx);
    if (run) runs.push(run);
  }

  if (runs.length < ROW_SAMPLE_COUNT * MIN_USABLE_ROWS) return null;

  const widthPx = median(runs.map((r) => r.right - r.left + 1));
  if (widthPx <= 0) return null;

  // Report the span at the median width, centred on the median centre, so the
  // drawn overlay is the width that was actually used.
  const centreOfRuns = median(runs.map((r) => (r.left + r.right) / 2));
  return {
    widthPx,
    x1: (centreOfRuns - widthPx / 2) / s.width,
    x2: (centreOfRuns + widthPx / 2) / s.width,
  };
}

export interface WaistLocation extends BodyWidth {
  /** Normalized height where the torso was narrowest. */
  y: number;
}

/** Heights sampled when hunting for the natural waist. */
const WAIST_SEARCH_STEPS = 24;

/**
 * Finds the natural waist: the narrowest point of the torso between the
 * bottom of the ribs and the hips.
 *
 * This is how a tailor finds it, and it is the fix for the measurement point
 * being a fixed fraction. A fraction lands wherever the proportions of one
 * subject put it — 35% of the way from the shoulder joints to the hip joints
 * landed on the lower ribs, which is why the waist constant had to force a
 * rib reading up to a waist figure. Searching for the minimum locates the
 * waist on each body instead of assuming every body is shaped like the one
 * the constant was fitted to.
 *
 * `yTopNorm` and `yBottomNorm` bound the search; the true waist sits well
 * inside the shoulder-to-hip span, and searching the whole of it would find
 * the neck or the crotch instead.
 */
export function findWaist(
  s: Silhouette,
  yTopNorm: number,
  yBottomNorm: number,
  centreXNorm: number,
): WaistLocation | null {
  if (yBottomNorm <= yTopNorm) return null;

  let best: WaistLocation | null = null;
  for (let i = 0; i <= WAIST_SEARCH_STEPS; i++) {
    const y = yTopNorm + ((yBottomNorm - yTopNorm) * i) / WAIST_SEARCH_STEPS;
    const w = bodyWidthAt(s, y, centreXNorm);
    if (w && (best === null || w.widthPx < best.widthPx)) {
      best = { ...w, y };
    }
  }
  return best;
}
