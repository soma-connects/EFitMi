"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import DraggableRect, { type ActivePoint } from "./DraggableRect";
import type { CapturedPhoto, PixelRect } from "@/lib/types";
import { worldShoulderCm } from "@/lib/plausibility";
import {
  scaleFor,
  toNatural as toNaturalRect,
  toScreen as toScreenRect,
  type View,
} from "@/lib/viewport";
import {
  CARD_ASPECT,
  CARD_WIDTH_MM,
  CORRECTION,
  LANDMARK,
  TYPICAL_SHOULDER_CM,
} from "@/lib/constants";

const CARD_WIDTH_CM = CARD_WIDTH_MM / 10;

/** How wide the card box should appear on screen when the view opens. */
const TARGET_ON_SCREEN_PX = 170;
const MIN_ZOOM = 1;
const MAX_ZOOM = 12;
const LOUPE_SIZE = 104;
const LOUPE_ZOOM = 2.5;

export default function CalibrateStep({
  photo,
  onConfirm,
  onRetake,
  submitting,
  error,
}: {
  photo: CapturedPhoto;
  onConfirm: (cardBoxWidthPxNatural: number, adjusted: boolean) => void;
  onRetake: () => void;
  submitting: boolean;
  error: string | null;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [rect, setRect] = useState<PixelRect | null>(null);
  const [userView, setUserView] = useState<View | null>(null);
  const [activePoint, setActivePoint] = useState<ActivePoint | null>(null);
  const [lockAspect, setLockAspect] = useState(true);

  const naturalAspect = photo.width / photo.height;

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      setViewport({ width, height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Seed the box from the body rather than a blind fraction of the frame: an
  // adult's shoulders span roughly TYPICAL_SHOULDER_CM, so the detected
  // shoulder width implies about how many pixels a card covers at that
  // distance. This is only a starting position — it is never treated as a
  // measurement (see `adjusted` below).
  const seedRect = useMemo<PixelRect>(() => {
    const ls = photo.landmarks[LANDMARK.LEFT_SHOULDER];
    const rs = photo.landmarks[LANDMARK.RIGHT_SHOULDER];
    const lh = photo.landmarks[LANDMARK.LEFT_HIP];
    const rh = photo.landmarks[LANDMARK.RIGHT_HIP];

    // Prefer the pose model's own estimate of this person's shoulders over
    // the average-adult constant — it puts the starting box closer for
    // people who aren't average. Still only a seed: it is never treated as a
    // measurement (see `adjusted` below).
    const joints = worldShoulderCm(photo.worldLandmarks);
    const assumedShoulderCm =
      joints !== null && joints > 15 && joints < 60
        ? joints * CORRECTION.SHOULDER
        : TYPICAL_SHOULDER_CM;

    const shoulderSpan = Math.abs(ls.x - rs.x) * photo.width;
    const seeded =
      shoulderSpan > 0
        ? shoulderSpan * (CARD_WIDTH_CM / assumedShoulderCm) * CORRECTION.SHOULDER
        : photo.width * 0.1;

    const width = Math.min(Math.max(seeded, 12), photo.width * 0.6);
    const height = width / CARD_ASPECT;

    const centerX = ((ls.x + rs.x) / 2) * photo.width;
    const shoulderY = ((ls.y + rs.y) / 2) * photo.height;
    const hipY = ((lh.y + rh.y) / 2) * photo.height;
    const centerY = shoulderY + (hipY - shoulderY) * 0.3;

    return {
      x: centerX - width / 2,
      y: centerY - height / 2,
      width,
      height,
    };
  }, [photo]);

  /** Natural photo pixels per viewport pixel at zoom 1. */
  const baseScale = viewport.width > 0 ? viewport.width / photo.width : 0;

  // Open already zoomed on the card. A card is only ~20px wide next to a
  // whole body, and no one can place a 20px box accurately on a phone — so
  // the view starts where the work actually happens. Derived at render
  // rather than in an effect, so it never fights the user's own zoom/pan.
  const defaultView = useMemo<View | null>(() => {
    if (viewport.width === 0 || baseScale === 0) return null;
    return {
      zoom: Math.min(
        MAX_ZOOM,
        Math.max(MIN_ZOOM, TARGET_ON_SCREEN_PX / (seedRect.width * baseScale)),
      ),
      cx: seedRect.x + seedRect.width / 2,
      cy: seedRect.y + seedRect.height / 2,
    };
  }, [viewport.width, baseScale, seedRect]);

  const view = userView ?? defaultView;
  const scale = view ? scaleFor(view, viewport, photo) : baseScale;

  const rectNatural = rect ?? seedRect;

  const screenRect = view
    ? toScreenRect(rectNatural, view, viewport, scale)
    : null;

  const cardWidthNatural = rectNatural.width;
  const lowResolution = cardWidthNatural > 0 && cardWidthNatural < 40;
  const adjusted = rect !== null;

  // Live sanity check on the box, shown while it can still be corrected.
  // Shoulder width is pure landmark distance, so it follows the box scale
  // exactly — which makes it a direct readout of whether the box is right.
  // If this says 31cm, the box is too wide, and every measurement will come
  // out short by the same proportion.
  const impliedShoulderCm = (() => {
    const ls = photo.landmarks[LANDMARK.LEFT_SHOULDER];
    const rs = photo.landmarks[LANDMARK.RIGHT_SHOULDER];
    const spanPx = Math.abs(ls.x - rs.x) * photo.width;
    if (spanPx <= 0 || cardWidthNatural <= 0) return null;
    return (spanPx * CORRECTION.SHOULDER * CARD_WIDTH_CM) / cardWidthNatural;
  })();

  // MediaPipe's own 3D estimate, independent of the card. When available it
  // beats a fixed range, because it adapts to this person rather than to an
  // average one.
  // Corrected the same way shoulder_width is, so the two are comparable:
  // world landmarks sit at the joint centres, inboard of the acromion.
  const poseJointsCm = worldShoulderCm(photo.worldLandmarks);
  const poseShoulderCm =
    poseJointsCm === null ? null : poseJointsCm * CORRECTION.SHOULDER;
  const shoulderLooksOff =
    impliedShoulderCm === null
      ? false
      : poseShoulderCm !== null
        ? Math.abs(impliedShoulderCm / poseShoulderCm - 1) > 0.25
        : impliedShoulderCm < 36 || impliedShoulderCm > 52;

  function nudgeZoom(factor: number) {
    setUserView((v) => {
      const base = v ?? defaultView;
      if (!base) return v;
      return {
        ...base,
        zoom: Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, base.zoom * factor)),
      };
    });
  }

  /** Recentre the view on the box, for when panning has lost it. */
  function centerOnBox() {
    setUserView((v) => {
      const base = v ?? defaultView;
      if (!base) return v;
      return {
        ...base,
        cx: rectNatural.x + rectNatural.width / 2,
        cy: rectNatural.y + rectNatural.height / 2,
      };
    });
  }

  function handleConfirm() {
    onConfirm(cardWidthNatural, adjusted);
  }

  return (
    <div className="flex flex-col items-center gap-4 w-full max-w-md mx-auto">
      <div className="text-center">
        <h2 className="font-semibold">Outline the card</h2>
        <p className="text-sm text-neutral-500">
          Drag the corners onto the card&apos;s edges. This sets the scale for
          every measurement, so it&apos;s worth getting exact.
        </p>
      </div>

      <div
        ref={containerRef}
        className="relative w-full rounded-2xl overflow-hidden shadow-lg bg-black select-none touch-none"
        style={{ aspectRatio: `${naturalAspect}` }}
      >
        {view && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={photo.dataUrl}
            alt="Captured photo"
            className="absolute left-0 top-0 max-w-none select-none pointer-events-none origin-top-left"
            draggable={false}
            style={{
              width: photo.width * scale,
              height: photo.height * scale,
              transform: `translate(${viewport.width / 2 - view.cx * scale}px, ${viewport.height / 2 - view.cy * scale}px)`,
            }}
          />
        )}

        {screenRect && viewport.width > 0 && (
          <DraggableRect
            rect={screenRect}
            bounds={viewport}
            aspectRatio={lockAspect ? CARD_ASPECT : undefined}
            onChange={(r) => view && setRect(toNaturalRect(r, view, viewport, scale))}
            onActivePointChange={setActivePoint}
            onPan={(dx, dy) =>
              setUserView((v) => {
                const base = v ?? defaultView;
                if (!base) return v;
                return { ...base, cx: base.cx - dx / scale, cy: base.cy - dy / scale };
              })
            }
          />
        )}

        {activePoint && view && (
          <div
            className="absolute pointer-events-none rounded-full border-2 border-white/80 shadow-lg overflow-hidden bg-black"
            style={{
              width: LOUPE_SIZE,
              height: LOUPE_SIZE,
              top: 10,
              left: activePoint.x > viewport.width / 2 ? 10 : undefined,
              right: activePoint.x > viewport.width / 2 ? undefined : 10,
              backgroundImage: `url(${photo.dataUrl})`,
              backgroundRepeat: "no-repeat",
              backgroundSize: `${photo.width * scale * LOUPE_ZOOM}px ${photo.height * scale * LOUPE_ZOOM}px`,
              backgroundPosition: `${LOUPE_SIZE / 2 - (activePoint.x + (view.cx * scale - viewport.width / 2)) * LOUPE_ZOOM}px ${LOUPE_SIZE / 2 - (activePoint.y + (view.cy * scale - viewport.height / 2)) * LOUPE_ZOOM}px`,
            }}
          >
            <div className="absolute left-1/2 top-0 bottom-0 w-px bg-yellow-400/80" />
            <div className="absolute top-1/2 left-0 right-0 h-px bg-yellow-400/80" />
          </div>
        )}

        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-1 rounded-full bg-black/65 backdrop-blur px-1 py-1">
          <button
            onClick={() => nudgeZoom(1 / 1.4)}
            aria-label="Zoom out"
            className="w-9 h-9 rounded-full text-white text-lg leading-none"
          >
            −
          </button>
          <button
            onClick={centerOnBox}
            className="px-3 h-9 rounded-full text-white text-xs font-medium"
          >
            Centre
          </button>
          <button
            onClick={() => nudgeZoom(1.4)}
            aria-label="Zoom in"
            className="w-9 h-9 rounded-full text-white text-lg leading-none"
          >
            +
          </button>
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm text-neutral-600 dark:text-neutral-300 self-start">
        <input
          type="checkbox"
          checked={lockAspect}
          onChange={(e) => setLockAspect(e.target.checked)}
          className="w-4 h-4 accent-yellow-500"
        />
        Lock to card shape
      </label>
      <p className="text-xs text-neutral-500 -mt-3 self-start">
        {lockAspect
          ? "The box keeps a bank card's exact proportions, so you only have to match the width. If the card won't fit it, the card was tilted — retake for a better result."
          : "Free resize. Only unlock if the card looks skewed in the photo; a skewed card gives a less accurate scale."}
      </p>

      {!adjusted && (
        <div className="w-full rounded-xl border border-blue-400/60 bg-blue-50 dark:bg-blue-950/40 p-3">
          <p className="text-sm text-blue-800 dark:text-blue-200">
            <span className="font-semibold">This box is only a guess.</span>{" "}
            It&apos;s sized from an average build, not from your card. Drag it
            onto the card&apos;s real edges — until you do, the measurements
            describe an average person rather than you.
          </p>
        </div>
      )}

      {impliedShoulderCm !== null && (
        <div
          className={`w-full rounded-xl border p-3 ${
            shoulderLooksOff
              ? "border-amber-400/60 bg-amber-50 dark:bg-amber-950/40"
              : "border-neutral-200 dark:border-neutral-700"
          }`}
        >
          <p className="text-sm">
            <span className="text-neutral-500">This box implies your shoulders are </span>
            <span className="font-semibold tabular-nums">
              {impliedShoulderCm.toFixed(0)} cm
            </span>
            <span className="text-neutral-500"> across.</span>
          </p>
          {poseShoulderCm !== null && (
            <p className="text-xs text-neutral-500 mt-0.5">
              The pose model independently estimates {poseShoulderCm.toFixed(0)} cm.
            </p>
          )}
          {shoulderLooksOff && (
            <p className="text-sm text-amber-700 dark:text-amber-300 mt-1">
              {(poseShoulderCm !== null
                ? impliedShoulderCm < poseShoulderCm
                : impliedShoulderCm < 36)
                ? "That's too narrow, so the box is reading wider than the card really is and every measurement will come out short. The usual cause is the card sitting closer to the camera than your body — press it flat against your chest, prop the phone up, and stand back a couple of metres."
                : "That's too broad, so the box is reading narrower than the card really is and every measurement will come out large. Widen it onto the card's edges, and check the card wasn't tilted away from the camera."}
            </p>
          )}
        </div>
      )}

      {lowResolution && (
        <p className="text-sm text-amber-500 text-center">
          The card is only ~{Math.round(cardWidthNatural)}px wide in the photo,
          so small placement errors will move the numbers a lot. Retaking from
          closer will help.
        </p>
      )}

      {error && <p className="text-sm text-red-500 text-center">{error}</p>}

      <div className="flex gap-3 w-full">
        <button
          onClick={onRetake}
          disabled={submitting}
          className="flex-1 py-3 rounded-xl font-medium border border-neutral-300 dark:border-neutral-600 disabled:opacity-50"
        >
          Retake
        </button>
        <button
          onClick={handleConfirm}
          disabled={submitting}
          className="flex-1 py-3 rounded-xl font-semibold text-white bg-neutral-900 dark:bg-white dark:text-neutral-900 disabled:opacity-50"
        >
          {submitting ? "Measuring…" : "Confirm"}
        </button>
      </div>
    </div>
  );
}
