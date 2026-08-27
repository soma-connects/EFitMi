import {
  FilesetResolver,
  PoseLandmarker,
  type NormalizedLandmark,
} from "@mediapipe/tasks-vision";

import type { Silhouette } from "./silhouette";

// Served from /public rather than a CDN so pose detection doesn't depend on
// a third-party origin being reachable at runtime.
const WASM_BASE = "/mediapipe/wasm";
const MODEL_URL = "/mediapipe/pose_landmarker_lite.task";

let landmarkerPromise: Promise<PoseLandmarker> | null = null;

/** Lazily creates a single shared PoseLandmarker running in VIDEO mode. */
export function getPoseLandmarker(): Promise<PoseLandmarker> {
  if (!landmarkerPromise) {
    landmarkerPromise = FilesetResolver.forVisionTasks(WASM_BASE).then(
      (fileset) =>
        PoseLandmarker.createFromOptions(fileset, {
          baseOptions: {
            modelAssetPath: MODEL_URL,
            delegate: "GPU",
          },
          runningMode: "VIDEO",
          numPoses: 1,
        }),
    );
  }
  return landmarkerPromise;
}

let stillPromise: Promise<PoseLandmarker> | null = null;

/**
 * A second landmarker in IMAGE mode, for the captured still.
 *
 * Two reasons it is separate from the one driving the live preview:
 *
 *   - **Determinism.** VIDEO mode is tracking mode: it carries state between
 *     frames and smooths across them, so the landmarks it reports depend on
 *     what came before. That is right for a preview and wrong for a
 *     measurement — it is the browser-side twin of the `static_image_mode`
 *     bug that made the Python service return different landmarks for the
 *     same photo. IMAGE mode treats the shot as the only frame there is.
 *   - **The segmentation mask.** It is what gives a measurement a baseline in
 *     the body rather than in a pose landmark span, and running it on every
 *     preview frame would cost far more than running it once on the shot.
 */
export function getStillPoseLandmarker(): Promise<PoseLandmarker> {
  if (!stillPromise) {
    stillPromise = FilesetResolver.forVisionTasks(WASM_BASE).then((fileset) =>
      PoseLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MODEL_URL, delegate: "GPU" },
        runningMode: "IMAGE",
        numPoses: 1,
        outputSegmentationMasks: true,
      }),
    );
  }
  return stillPromise;
}

/**
 * Runs the still detector on a decoded photo and returns its segmentation
 * mask plus the landmarks IMAGE mode saw.
 *
 * The mask must be copied out and closed here: MPMask can be backed by a
 * WebGL texture that the next detect call invalidates, so holding onto one
 * would hand later code a buffer that has quietly become someone else's.
 *
 * Returns null rather than throwing. A missing mask costs a diagnostic, not a
 * measurement — the shipped numbers do not depend on it — so a GPU that will
 * not produce one must not cost the user their photo.
 */
export async function analyseStill(
  source: HTMLImageElement | HTMLCanvasElement | ImageBitmap,
): Promise<{ silhouette: Silhouette | null; landmarks: NormalizedLandmark[] | null }> {
  try {
    const landmarker = await getStillPoseLandmarker();
    const result = landmarker.detect(source);
    const mask = result.segmentationMasks?.[0];

    let silhouette: Silhouette | null = null;
    if (mask) {
      try {
        silhouette = {
          width: mask.width,
          height: mask.height,
          data: Float32Array.from(mask.getAsFloat32Array()),
        };
      } finally {
        mask.close();
      }
    }

    return { silhouette, landmarks: result.landmarks?.[0] ?? null };
  } catch {
    return { silhouette: null, landmarks: null };
  }
}
