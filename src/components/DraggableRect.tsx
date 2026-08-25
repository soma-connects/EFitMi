"use client";

import { useRef, useState } from "react";
import type { PixelRect } from "@/lib/types";

const MAX_HANDLE_SIZE = 28;
const MIN_HANDLE_SIZE = 12;
const MIN_SIZE = 16;

type Corner = "nw" | "ne" | "sw" | "se";

type DragMode =
  | { type: "move"; startX: number; startY: number; origin: PixelRect }
  | { type: "pan"; lastX: number; lastY: number }
  | {
      type: "resize";
      corner: Corner;
      startX: number;
      startY: number;
      origin: PixelRect;
    };

export interface ActivePoint {
  x: number;
  y: number;
}

/**
 * A draggable, resizable rectangle overlaid on a container, in the
 * container's own pixel coordinate space — the caller handles any scaling.
 *
 * When `aspectRatio` is set the box keeps that shape while resizing. For the
 * card that is the point: its proportions are fixed and known, so the user
 * only has to match the width, and a card that cannot be made to fit the
 * locked shape is tilted relative to the camera — which is exactly the
 * condition that skews the scale.
 */
export default function DraggableRect({
  rect,
  bounds,
  aspectRatio,
  onChange,
  onActivePointChange,
  onPan,
}: {
  rect: PixelRect;
  bounds: { width: number; height: number };
  aspectRatio?: number;
  onChange: (rect: PixelRect) => void;
  onActivePointChange?: (point: ActivePoint | null) => void;
  /** Screen-space drag outside the box, for panning a zoomed view. */
  onPan?: (dx: number, dy: number) => void;
}) {
  const dragRef = useRef<DragMode | null>(null);
  const [dragging, setDragging] = useState(false);

  function clamp(r: PixelRect): PixelRect {
    let width = Math.max(MIN_SIZE, Math.min(r.width, bounds.width));
    let height = Math.max(MIN_SIZE, Math.min(r.height, bounds.height));

    if (aspectRatio) {
      // Keep the locked shape, shrinking to whichever axis binds.
      height = width / aspectRatio;
      if (height > bounds.height) {
        height = bounds.height;
        width = height * aspectRatio;
      }
      if (width > bounds.width) {
        width = bounds.width;
        height = width / aspectRatio;
      }
    }

    const x = Math.max(0, Math.min(r.x, bounds.width - width));
    const y = Math.max(0, Math.min(r.y, bounds.height - height));
    return { x, y, width, height };
  }

  /** Re-anchors a resized box so the corner opposite the dragged one stays put. */
  function anchor(next: PixelRect, corner: Corner, origin: PixelRect): PixelRect {
    const clamped = clamp(next);
    const right = origin.x + origin.width;
    const bottom = origin.y + origin.height;
    return {
      width: clamped.width,
      height: clamped.height,
      x: corner === "nw" || corner === "sw" ? right - clamped.width : origin.x,
      y: corner === "nw" || corner === "ne" ? bottom - clamped.height : origin.y,
    };
  }

  function handlePointerMove(e: React.PointerEvent) {
    const drag = dragRef.current;
    if (!drag) return;

    if (drag.type === "pan") {
      onPan?.(e.clientX - drag.lastX, e.clientY - drag.lastY);
      drag.lastX = e.clientX;
      drag.lastY = e.clientY;
      return;
    }

    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;

    if (drag.type === "move") {
      onChange(
        clamp({ ...drag.origin, x: drag.origin.x + dx, y: drag.origin.y + dy }),
      );
      reportActivePoint(e);
      return;
    }

    const o = drag.origin;
    // With a locked aspect only the width is steered; height follows in clamp().
    const widthDelta =
      drag.corner === "ne" || drag.corner === "se" ? dx : -dx;
    const heightDelta =
      drag.corner === "sw" || drag.corner === "se" ? dy : -dy;

    const next = aspectRatio
      ? { ...o, width: o.width + widthDelta }
      : { ...o, width: o.width + widthDelta, height: o.height + heightDelta };

    onChange(anchor(next, drag.corner, o));
    reportActivePoint(e);
  }

  function reportActivePoint(e: React.PointerEvent) {
    if (!onActivePointChange) return;
    const host = e.currentTarget.getBoundingClientRect();
    onActivePointChange({
      x: e.clientX - host.left,
      y: e.clientY - host.top,
    });
  }

  function startDrag(mode: DragMode) {
    dragRef.current = mode;
    setDragging(true);
  }

  function endDrag() {
    if (!dragRef.current) return;
    dragRef.current = null;
    setDragging(false);
    onActivePointChange?.(null);
  }

  // Handles sit fully outside a small box and shrink with it, so they never
  // cover the very edges the user is trying to line up.
  const handleSize = Math.round(
    Math.min(
      MAX_HANDLE_SIZE,
      Math.max(MIN_HANDLE_SIZE, Math.min(rect.width, rect.height) * 0.55),
    ),
  );
  const offset = rect.width < MAX_HANDLE_SIZE * 3 ? handleSize : handleSize / 2;

  const corners: Array<{ key: Corner; style: React.CSSProperties }> = [
    { key: "nw", style: { left: -offset, top: -offset, cursor: "nwse-resize" } },
    { key: "ne", style: { right: -offset, top: -offset, cursor: "nesw-resize" } },
    { key: "sw", style: { left: -offset, bottom: -offset, cursor: "nesw-resize" } },
    { key: "se", style: { right: -offset, bottom: -offset, cursor: "nwse-resize" } },
  ];

  return (
    <div
      onPointerDown={(e) => {
        // A drag that starts outside the box pans the view instead.
        if (!onPan) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        startDrag({ type: "pan", lastX: e.clientX, lastY: e.clientY });
      }}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      className="absolute inset-0 touch-none"
    >
      {/* Dim everything outside the box so the card's edges stand out. Four
          panes rather than one clipped overlay — a polygon with a hole needs
          a fill rule that CSS clip-path doesn't expose. */}
      <div
        className="absolute inset-0 pointer-events-none transition-opacity"
        style={{ opacity: dragging ? 0.35 : 1 }}
      >
        <div
          className="absolute bg-black/50"
          style={{ left: 0, top: 0, right: 0, height: Math.max(0, rect.y) }}
        />
        <div
          className="absolute bg-black/50"
          style={{ left: 0, top: rect.y + rect.height, right: 0, bottom: 0 }}
        />
        <div
          className="absolute bg-black/50"
          style={{ left: 0, top: rect.y, width: Math.max(0, rect.x), height: rect.height }}
        />
        <div
          className="absolute bg-black/50"
          style={{ left: rect.x + rect.width, top: rect.y, right: 0, height: rect.height }}
        />
      </div>

      <div
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          startDrag({ type: "move", startX: e.clientX, startY: e.clientY, origin: rect });
        }}
        className="absolute border-2 border-yellow-400 cursor-move touch-none"
        style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}
      >
        {/* Centre crosshair helps line the box up with the card's own centre. */}
        <div className="absolute inset-0 pointer-events-none opacity-60">
          <div className="absolute left-1/2 top-0 bottom-0 w-px bg-yellow-400/70" />
          <div className="absolute top-1/2 left-0 right-0 h-px bg-yellow-400/70" />
        </div>

        {corners.map((c) => (
          <div
            key={c.key}
            onPointerDown={(e) => {
              e.stopPropagation();
              e.currentTarget.setPointerCapture(e.pointerId);
              startDrag({
                type: "resize",
                corner: c.key,
                startX: e.clientX,
                startY: e.clientY,
                origin: rect,
              });
            }}
            className="absolute bg-yellow-400 rounded-full border-2 border-white shadow touch-none"
            style={{ width: handleSize, height: handleSize, ...c.style }}
          />
        ))}
      </div>
    </div>
  );
}
