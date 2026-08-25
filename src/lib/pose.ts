import { FilesetResolver, PoseLandmarker } from "@mediapipe/tasks-vision";

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
