// ISO/IEC 7810 ID-1 card size (bank/ATM/debit cards worldwide).
export const CARD_WIDTH_MM = 85.6;
export const CARD_HEIGHT_MM = 53.98;
export const CARD_ASPECT = CARD_WIDTH_MM / CARD_HEIGHT_MM;

// MediaPipe Pose (33-point BlazePose) landmark indices used in this app.
export const LANDMARK = {
  NOSE: 0,
  LEFT_EYE: 2,
  RIGHT_EYE: 5,
  LEFT_EAR: 7,
  RIGHT_EAR: 8,
  LEFT_SHOULDER: 11,
  RIGHT_SHOULDER: 12,
  LEFT_HIP: 23,
  RIGHT_HIP: 24,
  LEFT_KNEE: 25,
  RIGHT_KNEE: 26,
} as const;

// Correction multipliers inherited from the reference project
// (JavTahir/Live-Measurements-Api). They were tuned there against a
// height-guess calibration, so they remain unverified against a real tape
// measure under this project's card-based calibration. Treat as provisional.
export const CORRECTION = {
  SHOULDER: 1.1,
  CHEST: 1.15,
  WAIST: 1.16,
  HIP: 1.35,
} as const;

export const VISIBILITY_THRESHOLD = 0.5;
export const MIN_BRIGHTNESS = 40; // mean 0-255 luma sampled from the frame
export const CENTER_TOLERANCE = 0.18; // fraction of frame width off-center allowed
