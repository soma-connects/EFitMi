// Populates public/mediapipe/ with the assets the browser needs to run pose
// detection locally: the WASM runtime (copied out of node_modules) and the
// pose landmarker model (downloaded once). Serving these ourselves keeps the
// app from depending on a third-party CDN being reachable at runtime.
//
// These files are gitignored — run `npm run setup:mediapipe` after cloning.

import { cp, mkdir, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const destDir = join(root, "public", "mediapipe");
const wasmSrc = join(root, "node_modules", "@mediapipe", "tasks-vision", "wasm");
const wasmDest = join(destDir, "wasm");
const modelDest = join(destDir, "pose_landmarker_lite.task");
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";

await mkdir(destDir, { recursive: true });

await cp(wasmSrc, wasmDest, { recursive: true });
console.log(`Copied MediaPipe WASM runtime → ${wasmDest}`);

const alreadyHaveModel = await stat(modelDest).then(
  (s) => s.size > 0,
  () => false,
);
if (alreadyHaveModel) {
  console.log(`Model already present → ${modelDest}`);
} else {
  console.log(`Downloading pose landmarker model…`);
  const res = await fetch(MODEL_URL);
  if (!res.ok) {
    throw new Error(`Model download failed: ${res.status} ${res.statusText}`);
  }
  await writeFile(modelDest, Buffer.from(await res.arrayBuffer()));
  console.log(`Downloaded model → ${modelDest}`);
}
