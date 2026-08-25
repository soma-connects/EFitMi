import type { NormalizedLandmark } from "@mediapipe/tasks-vision";
import { CENTER_TOLERANCE, LANDMARK, MIN_BRIGHTNESS, VISIBILITY_THRESHOLD } from "./constants";

export interface FramingResult {
  ok: boolean;
  reasons: string[];
}

/** Real-time framing/quality gate run on every video frame before capture is allowed. */
export function checkFraming(
  landmarks: NormalizedLandmark[] | null,
  brightness: number,
): FramingResult {
  if (!landmarks) {
    return { ok: false, reasons: ["No person detected — step into frame"] };
  }

  const reasons: string[] = [];
  const vis = (i: number) => landmarks[i].visibility ?? 0;

  const upperBodyVisible = [
    LANDMARK.NOSE,
    LANDMARK.LEFT_SHOULDER,
    LANDMARK.RIGHT_SHOULDER,
    LANDMARK.LEFT_HIP,
    LANDMARK.RIGHT_HIP,
  ].every((i) => vis(i) >= VISIBILITY_THRESHOLD);
  if (!upperBodyVisible) {
    reasons.push("Move so your head, shoulders and hips are all visible");
  }

  const centerX =
    (landmarks[LANDMARK.LEFT_SHOULDER].x + landmarks[LANDMARK.RIGHT_SHOULDER].x) / 2;
  if (Math.abs(centerX - 0.5) > CENTER_TOLERANCE) {
    reasons.push("Move to the center of the frame");
  }

  if (brightness < MIN_BRIGHTNESS) {
    reasons.push("Too dark — move somewhere brighter");
  }

  return { ok: reasons.length === 0, reasons };
}

/** Mean 0-255 luma of a video frame, sampled cheaply from a downscaled canvas. */
export function sampleBrightness(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
): number {
  const { data } = ctx.getImageData(0, 0, width, height);
  let sum = 0;
  const pixelCount = data.length / 4;
  for (let i = 0; i < data.length; i += 4) {
    sum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  }
  return sum / pixelCount;
}
