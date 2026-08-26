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

/**
 * Wearing ease, in cm — how much a tailor adds to a body measurement so the
 * finished garment can be moved and breathed in.
 *
 * Taken from a real measurement sheet, where the convention is written as
 * "tight / with ease": chest 37/40 and waist 38/39 in inches. So the ease is
 * +3in at the chest and +1in at the waist — not a single blanket allowance,
 * which is why it's tabulated per measurement rather than computed.
 *
 * A measurement absent from this table has no ease convention on record.
 * Nothing is invented for it: the app shows the body figure alone rather
 * than a garment figure it cannot justify.
 */
export const EASE_CM: Partial<Record<string, number>> = {
  shoulder_width: 1 * 2.54,      // sheet: 18 / 19
  chest_circumference: 3 * 2.54, // sheet: 37 / 40
  waist: 1 * 2.54,               // sheet: 38 / 39
};

export const CORRECTION = {
  // Calibrated against a tailor's measurement sheet: this subject's body
  // shoulder is 18in (45.7cm), with 19in being the same shoulder plus
  // wearing ease. Against a MediaPipe joint-centre span of 32.73cm — a path
  // that never touches the card, so it carries no calibration error — that
  // gives 1.397.
  //
  // Supersedes an earlier 17in figure, which produced 1.35. The sheet value
  // is the one to trust: it was taken as part of a full measuring session
  // with the tight/ease convention written down.
  //
  // The inherited 1.1 was far too small either way: MediaPipe's shoulder
  // landmarks sit at the ball-and-socket joint centres, several centimetres
  // inboard of the bony point on each side.
  SHOULDER: 1.397,

  // Calibrated the same way, against the sheet's 37in (94.0cm) tight chest.
  // Chest width derives from the shoulder landmark span and the elliptical
  // model turns width into circumference by ~2.71, so the 32.73cm joint span
  // pins this at 1.059. Supersedes an earlier 36in figure (1.03).
  //
  // One circumference constrains the product, not the width and the 0.7
  // depth ratio separately. The depth ratio is at least anatomically
  // motivated, so the unvalidated inherited constant is the one that moved.
  CHEST: 1.059,

  // Calibrated to the tailor's waist point, deliberately: the sheet's 38in
  // trouser waist was taken over clothing, so an inch is deducted for fabric
  // bulk, giving 37in for the body at the waistband. Against the hip
  // landmark span (19.64cm, derived card-independently) that gives 1.961.
  //
  // Two things this does NOT mean:
  //
  //   - It is not the natural waist. The app measures at the lower ribs and
  //     this constant forces that reading up to a waistband-level figure. It
  //     is right for this subject by construction, and will drift on builds
  //     whose rib-to-waistband proportions differ. Moving the measurement
  //     point (see measure.ts, waistY) is the real fix.
  //   - It is not a validated figure in the sense shoulder and chest are.
  //     Those reproduce a direct tape reading of the thing they measure.
  //     This is fitted to a derived target.
  WAIST: 1.961,

  // NOT validated, and now visibly inconsistent: hip shares the same hip
  // landmark span as waist but only carries 1.35, so it reads ~28in against
  // a 37in waist — backwards for a human body. The consistency check in
  // plausibility.ts surfaces this rather than letting it pass silently.
  // Needs a real hip circumference measurement.
  HIP: 1.35,
} as const;

export const VISIBILITY_THRESHOLD = 0.5;
export const MIN_BRIGHTNESS = 40; // mean 0-255 luma sampled from the frame
export const CENTER_TOLERANCE = 0.18; // fraction of frame width off-center allowed
