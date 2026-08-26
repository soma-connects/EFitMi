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
// Rough adult shoulder width, used only to seed the card box near a sensible
// starting size on the calibrate screen. It never enters a measurement — the
// user's own confirmed box does — so an imprecise value here costs nothing
// but a slightly worse starting guess.
export const TYPICAL_SHOULDER_CM = 40;

export const CORRECTION = {
  // Validated against a tape: a subject measuring 17in (43.2cm) seam-to-seam
  // gave a MediaPipe joint-centre span of 32.7cm, implying 1.32 — and this
  // path never touches the card, so it carries no calibration error. 1.35 is
  // that figure rounded to the garment convention, and reproduces the tape
  // measurement to within 2.3%.
  //
  // The inherited 1.1 was far too small: MediaPipe's shoulder landmarks sit
  // at the ball-and-socket joint centres, several centimetres inboard of the
  // bony point on each side, and a garment's shoulder seam sits wider still.
  SHOULDER: 1.35,

  // Validated against a tape: the same subject taping a 36in (91.4cm) chest
  // circumference. Chest width is derived from the shoulder landmark span,
  // and the elliptical model turns width into circumference by a factor of
  // ~2.71, so the pose path's 32.7cm joint span pins this at 1.03. The
  // inherited 1.15 overshot the tape by 11.6% (it predicted a 40in chest).
  //
  // One circumference constrains the product, not the width and the 0.7
  // depth ratio separately. The depth ratio is at least anatomically
  // motivated, so the unvalidated inherited constant is the one that moved.
  CHEST: 1.03,

  // NOT validated. These are still the reference project's numbers, tuned
  // there against a height-guess calibration this project removed. Shoulder
  // needed a 23% revision and chest an 11% one, so treat these as suspect
  // until a tape says otherwise.
  WAIST: 1.16,
  HIP: 1.35,
} as const;

export const VISIBILITY_THRESHOLD = 0.5;
export const MIN_BRIGHTNESS = 40; // mean 0-255 luma sampled from the frame
export const CENTER_TOLERANCE = 0.18; // fraction of frame width off-center allowed
