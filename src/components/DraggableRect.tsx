"use client";

import { useRef, useState } from "react";
import type { PixelRect } from "@/lib/types";

const HANDLE_SIZE = 22;
const MIN_SIZE = 30;

type DragMode =
  | { type: "move"; startX: number; startY: number; origin: PixelRect }
  | {
      type: "resize";
      corner: "nw" | "ne" | "sw" | "se";
      startX: number;
      startY: number;
      origin: PixelRect;
    };

/**
 * A draggable, resizable rectangle overlaid on a container (in the
 * container's own pixel coordinate space — caller handles any scaling).
 */
export default function DraggableRect({
  rect,
  bounds,
  onChange,
}: {
  rect: PixelRect;
  bounds: { width: number; height: number };
  onChange: (rect: PixelRect) => void;
}) {
  const dragRef = useRef<DragMode | null>(null);
  const [, forceRender] = useState(0);

  function clamp(r: PixelRect): PixelRect {
    const width = Math.max(MIN_SIZE, Math.min(r.width, bounds.width));
    const height = Math.max(MIN_SIZE, Math.min(r.height, bounds.height));
    const x = Math.max(0, Math.min(r.x, bounds.width - width));
    const y = Math.max(0, Math.min(r.y, bounds.height - height));
    return { x, y, width, height };
  }

  function handlePointerMove(e: React.PointerEvent) {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;

    if (drag.type === "move") {
      onChange(
        clamp({ ...drag.origin, x: drag.origin.x + dx, y: drag.origin.y + dy }),
      );
      return;
    }

    const o = drag.origin;
    let next: PixelRect = { ...o };
    if (drag.corner === "se") {
      next = { ...o, width: o.width + dx, height: o.height + dy };
    } else if (drag.corner === "sw") {
      next = { x: o.x + dx, y: o.y, width: o.width - dx, height: o.height + dy };
    } else if (drag.corner === "ne") {
      next = { x: o.x, y: o.y + dy, width: o.width + dx, height: o.height - dy };
    } else {
      next = {
        x: o.x + dx,
        y: o.y + dy,
        width: o.width - dx,
        height: o.height - dy,
      };
    }
    onChange(clamp(next));
  }

  function startDrag(mode: DragMode) {
    dragRef.current = mode;
    forceRender((n) => n + 1);
  }

  function endDrag() {
    dragRef.current = null;
  }

  const corners: Array<{ key: "nw" | "ne" | "sw" | "se"; style: React.CSSProperties }> = [
    { key: "nw", style: { left: -HANDLE_SIZE / 2, top: -HANDLE_SIZE / 2, cursor: "nwse-resize" } },
    { key: "ne", style: { right: -HANDLE_SIZE / 2, top: -HANDLE_SIZE / 2, cursor: "nesw-resize" } },
    { key: "sw", style: { left: -HANDLE_SIZE / 2, bottom: -HANDLE_SIZE / 2, cursor: "nesw-resize" } },
    { key: "se", style: { right: -HANDLE_SIZE / 2, bottom: -HANDLE_SIZE / 2, cursor: "nwse-resize" } },
  ];

  return (
    <div
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerLeave={endDrag}
      className="absolute inset-0"
    >
      <div
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          startDrag({ type: "move", startX: e.clientX, startY: e.clientY, origin: rect });
        }}
        className="absolute border-2 border-yellow-400 bg-yellow-400/10 cursor-move touch-none"
        style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}
      >
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
            className="absolute bg-yellow-400 rounded-full border-2 border-white touch-none"
            style={{ width: HANDLE_SIZE, height: HANDLE_SIZE, ...c.style }}
          />
        ))}
      </div>
    </div>
  );
}
