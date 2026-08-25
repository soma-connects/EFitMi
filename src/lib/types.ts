import type { NormalizedLandmark } from "@mediapipe/tasks-vision";

export interface CapturedPhoto {
  /** data URL (image/jpeg) of the captured frame, at native camera resolution */
  dataUrl: string;
  width: number;
  height: number;
  landmarks: NormalizedLandmark[];
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
