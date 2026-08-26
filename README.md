# EFitMi

Phase 1: turn a guided phone photo into approximate body measurements,
calibrated to real-world scale using a bank card (ISO/IEC 7810 ID-1,
85.6mm × 53.98mm) held against the chest as a known-size reference object.

No garment generation, no try-on, no accounts, no persistence — that's a
later phase. This is just the capture → calibrate → measure pipeline,
working end to end.

## How it works

1. **Capture** (`/` in the Next.js app) — live camera preview with an
   on-screen body + card guide. MediaPipe Pose runs client-side
   (`@mediapipe/tasks-vision`) to gate the capture button on the person
   being centered, fully framed, and the shot being bright enough.
2. **Calibrate** — after capture, drag/resize a box over the card in the
   photo. Its pixel width, plus the card's known 8.56cm width, gives
   `scale_factor = 8.56 / card_box_width_px`.
3. **Measure** — `src/lib/measure.ts` converts the landmark pixel
   distances to centimeters using that scale, refines the widths with a
   contour scan of the photo, and derives chest/waist/hip circumferences
   from an elliptical approximation. Runs entirely in the browser.
4. **Results** — the photo with landmarks overlaid (for debugging/trust)
   plus the measurement list.

## Running it locally

One process — the app is fully client-side, with no backend to run.

```bash
npm install
npm run dev
npm test     # measurement + plausibility tests
```

Opens on http://localhost:3000. `npm install` also fetches the MediaPipe
WASM runtime and pose model into `public/mediapipe/` (gitignored); run
`npm run setup:mediapipe` directly if you ever need to refresh them.

### The Python service (`service/`) — currently unused

The measurement pipeline originally ran as a Flask service, and that code
is still in the repo. It is **not** part of the running app: `measure.ts`
is a direct port of it, verified to produce identical output to the
0.01cm on the same landmarks and photo.

It's kept because it holds the one capability the browser port doesn't —
MiDaS depth estimation, which refines the circumference estimates. In
practice that was already dormant (every response returned
`depth_refinement: false`, since the weights need a `torch.hub` download),
which is what made the port lossless. If you revive it, keep the geometry
in the two implementations in sync.

```bash
cd service
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python app.py          # http://localhost:8001
python test_calibration.py   # calibration checks, no heavy deps needed
```

## Credit

The measurement pipeline (`src/lib/measure.ts`, ported from
`service/app.py`) is adapted from
[JavTahir/Live-Measurements-Api](https://github.com/JavTahir/Live-Measurements-Api)
(MIT License) — MediaPipe pose extraction, contour-assisted width
detection, and the MiDaS-based circumference estimate are carried over
from that project. The main change: the original calibrates scale from a
self-reported height by default, falling back to an unreliable
largest-contour guess at a sheet of A4 paper only when pose detection
fails outright. This version instead calibrates directly from the
user-confirmed bank card bounding box described above, since that's the
actual scale reference this project is built around. See
`service/LICENSE-live-measurements-api` for the original license text.

## Accuracy status — read before trusting a number

The card calibration itself is verified: `service/test_calibration.py` checks
the pixel→cm arithmetic, and an end-to-end run confirms **every** measurement
— shoulder, chest, waist and hip — scales exactly linearly with the confirmed
card width (doubling the card box halves the measurements, as it must).
Repeated requests with identical input now return identical results.

`npm test` runs the measurement and plausibility suites on Node's built-in
test runner (no framework to install): scale arithmetic, linear scaling with
card width, resolution independence, determinism, and that a wild contour
reading can't inflate a result. Each was checked against a deliberately
reintroduced bug to confirm it actually fails when the behaviour regresses.

What is **not** yet verified:

- **The correction multipliers are inherited and unproven.** Shoulder ×1.1,
  chest ×1.15, waist ×1.16, hip ×1.35 come from the reference project, where
  they were tuned against its height-guess calibration. They have not been
  re-checked against a real tape measure since the calibration was replaced.
  Treat them as provisional.
- Accuracy depends on the card being flat to the camera and roughly coplanar
  with the body. A tilted card reads narrower than it is, which inflates every
  measurement proportionally.

The phase 1 acceptance test is a physical one: hold a tape measure to your own
shoulders and compare. If a number is absurd (15cm, 300cm), that's a
calibration bug and takes priority over any polish.

## Non-goals for this phase

Fabric capture/generation, virtual try-on, accounts, persistence, a native
app, automatic (non-manual) card detection, and any measurement beyond
shoulder/chest/waist/hip. See the phase 1 spec for the full rationale.
