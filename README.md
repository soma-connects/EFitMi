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
3. **Measure** — the photo and `card_box_width_px` are sent to a small
   Flask service (`service/`), which re-runs pose detection server-side,
   estimates a relative depth map (MiDaS) to inform an elliptical
   circumference estimate, and returns shoulder/chest/waist/hip
   measurements in centimeters.
4. **Results** — the photo with landmarks overlaid (for debugging/trust)
   plus the measurement list.

## Running it locally

Two processes: the Next.js frontend, and the Python measurement service.

### Frontend

```bash
npm install
npm run dev
```

Opens on http://localhost:3000.

### Measurement service

```bash
cd service
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python app.py
```

Runs on http://localhost:8001. First startup downloads MiDaS_small weights
via `torch.hub` — needs outbound network access once.

The frontend expects the service at `NEXT_PUBLIC_MEASUREMENT_API_URL`
(defaults to `http://localhost:8001` — see `.env.local.example`).

## Credit

The measurement service (`service/app.py`) is adapted from
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
