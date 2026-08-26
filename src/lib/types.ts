import type { NormalizedLandmark } from "@mediapipe/tasks-vision";

export interface CapturedPhoto {
  /** data URL (image/jpeg) of the captured frame, at native camera resolution */
  dataUrl: string;
  width: number;
  height: number;
  landmarks: NormalizedLandmark[];
  /**
   * MediaPipe's 3D pose estimate, in metres, origin at the hip centre.
   *
   * Never used as a measurement — it comes from the model's body prior, not
   * from this person, which is exactly the assumed-scale problem the card
   * exists to avoid. It is used only as an independent second opinion on
   * whether the card-derived scale is sane, since it doesn't depend on the
   * card at all.
   */
  worldLandmarks?: NormalizedLandmark[];
}

export interface PixelRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Shape returned by the Flask measurement service's /measure endpoint. */
export interface Measurements {
  shoulder_width: number;
  chest_width: number;
  chest_circumference: number;
  waist_width: number;
  waist: number;
  hip_width: number;
  hip: number;
}

export type Step = "intro" | "capture" | "calibrate" | "results";
