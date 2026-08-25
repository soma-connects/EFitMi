"use client";

import { useEffect, useRef, useState } from "react";
import DraggableRect from "./DraggableRect";
import type { CapturedPhoto, PixelRect } from "@/lib/types";
import { CARD_ASPECT } from "@/lib/constants";

export default function CalibrateStep({
  photo,
  onConfirm,
  onRetake,
  submitting,
  error,
}: {
  photo: CapturedPhoto;
  onConfirm: (cardBoxWidthPxNatural: number) => void;
  onRetake: () => void;
  submitting: boolean;
  error: string | null;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [displaySize, setDisplaySize] = useState({ width: 0, height: 0 });
  const [rect, setRect] = useState<PixelRect | null>(null);

  const naturalAspect = photo.width / photo.height;

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      setDisplaySize({ width, height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Seed a plausible default box near chest height, roughly card-shaped,
  // sized off a fraction of the photo width — user drags it onto the
  // actual card from here. Derived at render time (not an effect) so it
  // never fights the user's own drag/resize state once that exists.
  function defaultRect(size: { width: number; height: number }): PixelRect {
    const width = size.width * 0.28;
    const height = width / CARD_ASPECT;
    return {
      x: size.width / 2 - width / 2,
      y: size.height * 0.5 - height / 2,
      width,
      height,
    };
  }

  const displayRect = rect ?? (displaySize.width > 0 ? defaultRect(displaySize) : null);

  function handleConfirm() {
    if (!displayRect || displaySize.width === 0) return;
    const scale = photo.width / displaySize.width;
    onConfirm(displayRect.width * scale);
  }

  return (
    <div className="flex flex-col items-center gap-4 w-full max-w-md mx-auto">
      <p className="text-sm text-center text-neutral-500">
        Drag and resize the yellow box so it exactly outlines the card in the
        photo.
      </p>

      <div
        ref={containerRef}
        className="relative w-full rounded-2xl overflow-hidden shadow-lg bg-black"
        style={{ aspectRatio: `${naturalAspect}` }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={photo.dataUrl}
          alt="Captured photo"
          className="absolute inset-0 w-full h-full object-contain select-none pointer-events-none"
          draggable={false}
        />
        {displayRect && displaySize.width > 0 && (
          <DraggableRect rect={displayRect} bounds={displaySize} onChange={setRect} />
        )}
      </div>

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
          {submitting ? "Measuring…" : "Confirm card position"}
        </button>
      </div>
    </div>
  );
}
