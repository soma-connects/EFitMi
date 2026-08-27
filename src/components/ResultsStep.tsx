"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import {
  checkAgainstPose,
  checkConsistency,
  checkPlausibility,
  checkSquareness,
  verdictFor,
} from "@/lib/plausibility";
import type { CalibrationReadout, MeasuredSpan } from "@/lib/measure";
import type { CapturedPhoto, Measurements } from "@/lib/types";
import { EASE_CM } from "@/lib/constants";

const DISPLAY_WIDTH = 640;

type Unit = "cm" | "in";

interface Row {
  key: keyof Measurements;
  label: string;
  note?: string;
}

interface Group {
  title: string;
  /** Shown under the heading, explaining how far to trust the group. */
  caption: string;
  validated: boolean;
  rows: Row[];
}

/**
 * Grouped by how much the numbers can be trusted, not by what they measure.
 *
 * Shoulder, chest and waist have been checked against a tape on a real
 * subject and reproduce it. Hip still uses the reference project's constant,
 * tuned there against a calibration this project removed. Presenting all
 * seven with equal weight would imply a confidence two of them haven't
 * earned.
 */
const GROUPS: Group[] = [
  {
    title: "Checked against a tape",
    caption: "These corrections were calibrated on a real body and reproduce it.",
    validated: true,
    rows: [
      { key: "shoulder_width", label: "Shoulder", note: "seam to seam" },
      { key: "chest_circumference", label: "Chest", note: "circumference" },
      { key: "chest_width", label: "Chest width", note: "across the body" },
      { key: "waist", label: "Waist", note: "circumference" },
      { key: "waist_width", label: "Waist width", note: "across the body" },
    ],
  },
  {
    title: "Not yet verified",
    caption:
      "Still using an inherited constant. Measure this with a tape before cutting anything.",
    validated: false,
    rows: [
      { key: "hip", label: "Hip", note: "circumference" },
      { key: "hip_width", label: "Hip width", note: "across the body" },
    ],
  },
];


/**
 * The readout, in the order a refit needs it: the spans the constants are
 * currently hung on, then what the body measures at each point.
 */
const CALIBRATION_ROWS: Array<{
  label: string;
  value: (c: CalibrationReadout) => string | null;
}> = [
  {
    label: "Shoulder joint span",
    value: (c) => `${c.shoulderJointSpanCm.toFixed(2)} cm`,
  },
  { label: "Hip joint span", value: (c) => `${c.hipJointSpanCm.toFixed(2)} cm` },
  {
    label: "Chest, at the body",
    value: (c) => (c.chestBodyCm === null ? null : `${c.chestBodyCm.toFixed(2)} cm`),
  },
  {
    label: "Waist, at the body",
    value: (c) => (c.waistBodyCm === null ? null : `${c.waistBodyCm.toFixed(2)} cm`),
  },
  {
    label: "Hip, at the body",
    value: (c) => (c.hipBodyCm === null ? null : `${c.hipBodyCm.toFixed(2)} cm`),
  },
  {
    label: "Narrowest point, shoulders → hips",
    value: (c) =>
      c.waistAtFraction === null
        ? null
        : `${(c.waistAtFraction * 100).toFixed(1)}%  (measured at 35%)`,
  },
];

export default function ResultsStep({
  photo,
  measurements,
  spans,
  calibration,
  cardAdjusted,
  onStartOver,
  onAdjustCard,
}: {
  photo: CapturedPhoto;
  measurements: Measurements;
  spans: MeasuredSpan[];
  calibration: CalibrationReadout | null;
  cardAdjusted: boolean;
  onStartOver: () => void;
  onAdjustCard: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [unit, setUnit] = useState<Unit>("cm");
  const [copied, setCopied] = useState(false);
  const [copiedCalibration, setCopiedCalibration] = useState(false);

  const report = useMemo(() => checkPlausibility(measurements), [measurements]);
  const scaleReport = useMemo(
    () => checkAgainstPose(measurements, photo.worldLandmarks),
    [measurements, photo.worldLandmarks],
  );
  const consistency = useMemo(() => checkConsistency(measurements), [measurements]);
  const squareness = useMemo(
    () => checkSquareness(photo.worldLandmarks),
    [photo.worldLandmarks],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const displayScale = DISPLAY_WIDTH / photo.width;
    canvas.width = DISPLAY_WIDTH;
    canvas.height = photo.height * displayScale;

    const img = new Image();
    img.onload = () => {
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

      // Draw the spans that were actually measured, not just the landmarks.
      // A "waist" line sitting on a jacket hem explains a wrong number in a
      // way the number alone cannot.
      spans.forEach((span) => {
        const y = span.y * canvas.height;
        const x1 = span.x1 * canvas.width;
        const x2 = span.x2 * canvas.width;
        // Green = pose landmarks, blue = the old contour scan, amber dashed =
        // the segmentation mask. The mask lines are what the body actually
        // measures; they are drawn differently because they are not what the
        // numbers above them were derived from.
        const fromMask = span.source === "silhouette";
        const color = fromMask
          ? "#fbbf24"
          : span.source === "contour"
            ? "#38bdf8"
            : "#4ade80";

        ctx.strokeStyle = color;
        ctx.lineWidth = 3;
        ctx.setLineDash(fromMask ? [7, 5] : []);
        ctx.beginPath();
        ctx.moveTo(x1, y);
        ctx.lineTo(x2, y);
        ctx.stroke();
        ctx.setLineDash([]);

        // End caps, so the exact extent is unambiguous.
        ctx.lineWidth = 2;
        for (const x of [x1, x2]) {
          ctx.beginPath();
          ctx.moveTo(x, y - 7);
          ctx.lineTo(x, y + 7);
          ctx.stroke();
        }

        ctx.font = "600 13px system-ui, sans-serif";
        ctx.fillStyle = color;
        ctx.strokeStyle = "rgba(0,0,0,0.65)";
        ctx.lineWidth = 3;
        ctx.strokeText(span.label, x2 + 8, y + 4);
        ctx.fillText(span.label, x2 + 8, y + 4);
      });
    };
    img.src = photo.dataUrl;
  }, [photo, spans]);

  const format = (cm: number) =>
    unit === "cm" ? `${cm.toFixed(1)} cm` : `${(cm / 2.54).toFixed(1)} in`;

  async function copyAll() {
    // The copied text is what actually reaches a tailor, so the distinction
    // between checked and unchecked numbers has to travel with it. A bare
    // list would strip exactly the context that stops someone cutting from
    // an unverified waist.
    const lines = GROUPS.flatMap((g) => [
      `${g.title}:`,
      ...g.rows.map((r) => {
        const ease = EASE_CM[r.key];
        const body = format(measurements[r.key]);
        // Tailor's convention: body / with-ease, as written on a
        // measurement sheet (chest 37/40).
        return ease === undefined
          ? `  ${r.label}: ${body}`
          : `  ${r.label}: ${body} tight / ${format(measurements[r.key] + ease)} with ease`;
      }),
      "",
    ]);
    lines.push("Estimated from a photo, not a substitute for a tape measure.");

    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard can be blocked; the numbers are on screen regardless.
    }
  }

  async function copyCalibration() {
    if (!calibration) return;
    const lines = [
      "EFitMi calibration data",
      ...CALIBRATION_ROWS.map(
        ({ label, value }) => `${label}: ${value(calibration) ?? "not found"}`,
      ),
      "",
      "Body figures come from the segmentation mask and feed nothing that was",
      "reported; joint spans are what the correction constants are fitted to.",
    ];
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      setCopiedCalibration(true);
      setTimeout(() => setCopiedCalibration(false), 2000);
    } catch {
      // Clipboard can be blocked; the numbers are on screen regardless.
    }
  }

  return (
    <div className="flex flex-col items-center gap-4 w-full max-w-md mx-auto">
      <canvas
        ref={canvasRef}
        className="rounded-2xl shadow-lg w-full"
        aria-label="Captured photo with the measured spans drawn on it"
      />

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-neutral-500 self-start">
        <span className="flex items-center gap-1.5">
          <span className="w-4 h-0.5 bg-[#4ade80]" />
          measured from pose landmarks
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-4 h-0.5 bg-[#38bdf8]" />
          measured from the photo&apos;s outline
        </span>
        <span className="flex items-center gap-1.5">
          <span
            className="w-4 border-t-2 border-dashed border-[#fbbf24]"
            aria-hidden
          />
          your actual outline — not used in the numbers
        </span>
      </div>

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

      {!squareness.ok && (
        <div className="w-full rounded-xl border border-amber-400/60 bg-amber-50 dark:bg-amber-950/40 p-3">
          <p className="text-sm font-semibold text-amber-700 dark:text-amber-300">
            You weren&apos;t square to the camera
          </p>
          <p className="text-sm text-amber-700/90 dark:text-amber-200/90 mt-1">
            {squareness.message}
          </p>
          <button
            onClick={onStartOver}
            className="mt-2 text-sm font-medium underline text-amber-800 dark:text-amber-200"
          >
            Retake the photo
          </button>
        </div>
      )}

      {!scaleReport.ok && (
        <div className="w-full rounded-xl border border-amber-400/60 bg-amber-50 dark:bg-amber-950/40 p-3">
          <p className="text-sm font-semibold text-amber-700 dark:text-amber-300">
            The scale looks off
          </p>
          <p className="text-sm text-amber-700/90 dark:text-amber-200/90 mt-1">
            {scaleReport.message}
          </p>
          <button
            onClick={onAdjustCard}
            className="mt-2 text-sm font-medium underline text-amber-800 dark:text-amber-200"
          >
            Adjust the card box
          </button>
        </div>
      )}

      {!consistency.ok && (
        <div className="w-full rounded-xl border border-amber-400/60 bg-amber-50 dark:bg-amber-950/40 p-3">
          <p className="text-sm font-semibold text-amber-700 dark:text-amber-300">
            These measurements disagree with each other
          </p>
          <p className="text-sm text-amber-700/90 dark:text-amber-200/90 mt-1">
            {consistency.message}
          </p>
        </div>
      )}

      {!report.ok && scaleReport.ok && (
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
            <div className="flex items-center gap-2 mb-1">
              <span
                className={`inline-block w-1.5 h-1.5 rounded-full ${
                  group.validated ? "bg-green-500" : "bg-amber-500"
                }`}
                aria-hidden
              />
              <p className="text-xs uppercase tracking-wide text-neutral-500">
                {group.title}
              </p>
            </div>
            <p className="text-xs text-neutral-500 mb-1.5">{group.caption}</p>
            <div className="divide-y divide-neutral-200 dark:divide-neutral-700 border border-neutral-200 dark:border-neutral-700 rounded-xl overflow-hidden">
              {group.rows.map((r) => {
                const value = measurements[r.key];
                const verdict = verdictFor(r.key, value);
                const ease = EASE_CM[r.key];
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
                    <div className="text-right">
                      <p
                        className={`text-lg font-semibold tabular-nums ${
                          verdict !== "ok"
                            ? "text-amber-500"
                            : group.validated
                              ? ""
                              : "text-neutral-500"
                        }`}
                        title={
                          verdict === "ok"
                            ? undefined
                            : `Outside the expected range (${verdict})`
                        }
                      >
                        {format(value)}
                      </p>
                      {ease !== undefined && (
                        <p className="text-xs text-neutral-500 tabular-nums">
                          {format(value + ease)} with ease
                        </p>
                      )}
                    </div>
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

      {calibration && (
        <details className="w-full rounded-xl border border-neutral-200 dark:border-neutral-800 p-3">
          <summary className="text-sm font-semibold cursor-pointer">
            Calibration data
          </summary>
          <p className="text-xs text-neutral-500 mt-2">
            What the segmentation mask says your body actually measures, next
            to the pose landmark spans the reported numbers are derived from.
            None of this feeds the measurements above — it is here so a tape
            reading can be matched against the body rather than against a
            landmark span. Amber dashed lines on the photo show where each was
            taken.
          </p>
          <dl className="mt-3 text-sm grid grid-cols-[1fr_auto] gap-x-4 gap-y-1">
            {CALIBRATION_ROWS.map(({ label, value }) => {
              const v = value(calibration);
              return (
                <Fragment key={label}>
                  <dt className="text-neutral-500">{label}</dt>
                  <dd className="tabular-nums">
                    {v === null ? "—" : v}
                  </dd>
                </Fragment>
              );
            })}
          </dl>
          <button
            onClick={copyCalibration}
            className="mt-3 text-sm font-medium underline"
          >
            {copiedCalibration ? "Copied" : "Copy calibration data"}
          </button>
        </details>
      )}
    </div>
  );
}
