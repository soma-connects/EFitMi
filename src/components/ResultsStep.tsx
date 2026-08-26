"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { LANDMARK } from "@/lib/constants";
import { checkPlausibility, verdictFor } from "@/lib/plausibility";
import type { CapturedPhoto, Measurements } from "@/lib/types";

const DISPLAY_WIDTH = 640;

type Unit = "cm" | "in";

interface Row {
  key: keyof Measurements;
  label: string;
  note?: string;
}

const GROUPS: Array<{ title: string; rows: Row[] }> = [
  {
    title: "Widths",
    rows: [
      { key: "shoulder_width", label: "Shoulder" },
      { key: "chest_width", label: "Chest" },
      { key: "waist_width", label: "Waist", note: "derived from hip landmarks" },
      { key: "hip_width", label: "Hip" },
    ],
  },
  {
    title: "Circumferences",
    rows: [
      { key: "chest_circumference", label: "Chest", note: "estimated" },
      { key: "waist", label: "Waist", note: "estimated" },
      { key: "hip", label: "Hip", note: "estimated" },
    ],
  },
];

export default function ResultsStep({
  photo,
  measurements,
  cardAdjusted,
  onStartOver,
  onAdjustCard,
}: {
  photo: CapturedPhoto;
  measurements: Measurements;
  cardAdjusted: boolean;
  onStartOver: () => void;
  onAdjustCard: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [unit, setUnit] = useState<Unit>("cm");
  const [copied, setCopied] = useState(false);

  const report = useMemo(() => checkPlausibility(measurements), [measurements]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const scale = DISPLAY_WIDTH / photo.width;
    canvas.width = DISPLAY_WIDTH;
    canvas.height = photo.height * scale;

    const img = new Image();
    img.onload = () => {
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

      const pt = (i: number) => ({
        x: photo.landmarks[i].x * canvas.width,
        y: photo.landmarks[i].y * canvas.height,
      });

      const line = (
        a: { x: number; y: number },
        b: { x: number; y: number },
        color: string,
      ) => {
        ctx.strokeStyle = color;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      };

      const dot = (p: { x: number; y: number }, color: string) => {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "rgba(0,0,0,0.5)";
        ctx.lineWidth = 1.5;
        ctx.stroke();
      };

      const leftShoulder = pt(LANDMARK.LEFT_SHOULDER);
      const rightShoulder = pt(LANDMARK.RIGHT_SHOULDER);
      const leftHip = pt(LANDMARK.LEFT_HIP);
      const rightHip = pt(LANDMARK.RIGHT_HIP);

      line(leftShoulder, rightShoulder, "#4ade80");
      line(leftHip, rightHip, "#38bdf8");
      [leftShoulder, rightShoulder].forEach((p) => dot(p, "#4ade80"));
      [leftHip, rightHip].forEach((p) => dot(p, "#38bdf8"));
    };
    img.src = photo.dataUrl;
  }, [photo]);

  const format = (cm: number) =>
    unit === "cm" ? `${cm.toFixed(1)} cm` : `${(cm / 2.54).toFixed(1)} in`;

  async function copyAll() {
    const lines = GROUPS.flatMap((g) =>
      g.rows.map(
        (r) => `${g.title === "Circumferences" ? `${r.label} (circ.)` : r.label}: ${format(measurements[r.key])}`,
      ),
    );
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard can be blocked; the numbers are on screen regardless.
    }
  }

  return (
    <div className="flex flex-col items-center gap-4 w-full max-w-md mx-auto">
      <canvas
        ref={canvasRef}
        className="rounded-2xl shadow-lg w-full"
        aria-label="Captured photo with detected body landmarks overlaid"
      />

      {!cardAdjusted && (
        <div className="w-full rounded-xl border border-blue-400/60 bg-blue-50 dark:bg-blue-950/40 p-3">
          <p className="text-sm font-semibold text-blue-800 dark:text-blue-200">
            Not calibrated to your card
          </p>
          <p className="text-sm text-blue-800/90 dark:text-blue-200/90 mt-1">
            You confirmed the card box without moving it, so these numbers come
            from an average build rather than your photo&apos;s actual scale.
            Place the box on the card to get real measurements.
          </p>
          <button
            onClick={onAdjustCard}
            className="mt-2 text-sm font-medium underline text-blue-900 dark:text-blue-200"
          >
            Place the box on the card
          </button>
        </div>
      )}

      {!report.ok && (
        <div className="w-full rounded-xl border border-amber-400/60 bg-amber-50 dark:bg-amber-950/40 p-3">
          <p className="text-sm font-semibold text-amber-700 dark:text-amber-300">
            These numbers don&apos;t look right
          </p>
          <p className="text-sm text-amber-700/90 dark:text-amber-200/90 mt-1">
            {report.message}
          </p>
          <button
            onClick={onAdjustCard}
            className="mt-2 text-sm font-medium underline text-amber-800 dark:text-amber-200"
          >
            Adjust the card box
          </button>
        </div>
      )}

      <div className="flex items-center justify-between w-full">
        <div
          className="inline-flex rounded-lg border border-neutral-300 dark:border-neutral-600 overflow-hidden"
          role="group"
          aria-label="Units"
        >
          {(["cm", "in"] as Unit[]).map((u) => (
            <button
              key={u}
              onClick={() => setUnit(u)}
              aria-pressed={unit === u}
              className={`px-3 py-1.5 text-sm font-medium ${
                unit === u
                  ? "bg-neutral-900 text-white dark:bg-white dark:text-neutral-900"
                  : "text-neutral-600 dark:text-neutral-300"
              }`}
            >
              {u}
            </button>
          ))}
        </div>
        <button
          onClick={copyAll}
          className="text-sm font-medium text-neutral-600 dark:text-neutral-300 underline"
        >
          {copied ? "Copied" : "Copy all"}
        </button>
      </div>

      <div className="w-full space-y-3">
        {GROUPS.map((group) => (
          <div key={group.title}>
            <p className="text-xs uppercase tracking-wide text-neutral-500 mb-1">
              {group.title}
            </p>
            <div className="divide-y divide-neutral-200 dark:divide-neutral-700 border border-neutral-200 dark:border-neutral-700 rounded-xl overflow-hidden">
              {group.rows.map((r) => {
                const value = measurements[r.key];
                const verdict = verdictFor(r.key, value);
                return (
                  <div
                    key={`${group.title}-${r.key}`}
                    className="flex justify-between items-baseline px-4 py-3"
                  >
                    <div>
                      <p className="font-medium">{r.label}</p>
                      {r.note && (
                        <p className="text-xs text-neutral-500">{r.note}</p>
                      )}
                    </div>
                    <p
                      className={`text-lg font-semibold tabular-nums ${
                        verdict === "ok" ? "" : "text-amber-500"
                      }`}
                      title={
                        verdict === "ok"
                          ? undefined
                          : `Outside the expected range (${verdict})`
                      }
                    >
                      {format(value)}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <details className="w-full rounded-xl border border-neutral-200 dark:border-neutral-700 overflow-hidden">
        <summary className="px-4 py-3 text-sm font-medium cursor-pointer select-none">
          Getting a more accurate result
        </summary>
        <ul className="px-4 pb-3 space-y-2 text-sm text-neutral-600 dark:text-neutral-300">
          <li>
            <span className="font-medium">The card box is everything.</span>{" "}
            It scales every number here — a 10% error in the box is a 10% error
            in every measurement. Zoom right in when you place it.
          </li>
          <li>
            <span className="font-medium">Keep the card flat on.</span> Tilted
            away from the camera it reads narrower than it is, which makes you
            measure larger than you are.
          </li>
          <li>
            <span className="font-medium">Stand square and step back.</span>{" "}
            Turning even slightly shortens your shoulder span, and the further
            you are, the fewer pixels the card covers.
          </li>
          <li>
            <span className="font-medium">Wear something close-fitting.</span>{" "}
            The width scan follows the outline it can see, so a loose garment
            is measured instead of you.
          </li>
        </ul>
      </details>

      <p className="text-xs text-neutral-500 text-center">
        Estimates, not tailoring-grade measurements. Circumferences are derived
        from width using an elliptical model, so they are the roughest figures
        here — check them against a tape before trusting them for a garment.
      </p>

      <div className="flex gap-3 w-full">
        <button
          onClick={onAdjustCard}
          className="flex-1 py-3 rounded-xl font-medium border border-neutral-300 dark:border-neutral-600"
        >
          Adjust card
        </button>
        <button
          onClick={onStartOver}
          className="flex-1 py-3 rounded-xl font-semibold text-white bg-neutral-900 dark:bg-white dark:text-neutral-900"
        >
          Start over
        </button>
      </div>
    </div>
  );
}
