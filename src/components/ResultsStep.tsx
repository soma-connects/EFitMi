"use client";

import { useEffect, useRef } from "react";
import { LANDMARK } from "@/lib/constants";
import type { CapturedPhoto, Measurements } from "@/lib/types";

const DISPLAY_WIDTH = 480;

export default function ResultsStep({
  photo,
  measurements,
  onStartOver,
}: {
  photo: CapturedPhoto;
  measurements: Measurements;
  onStartOver: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

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

      ctx.strokeStyle = "#4ade80";
      ctx.lineWidth = 2;
      ctx.fillStyle = "#4ade80";

      const line = (a: { x: number; y: number }, b: { x: number; y: number }) => {
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      };

      const dot = (p: { x: number; y: number }) => {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
        ctx.fill();
      };

      const leftShoulder = pt(LANDMARK.LEFT_SHOULDER);
      const rightShoulder = pt(LANDMARK.RIGHT_SHOULDER);
      const leftHip = pt(LANDMARK.LEFT_HIP);
      const rightHip = pt(LANDMARK.RIGHT_HIP);

      line(leftShoulder, rightShoulder);
      line(leftHip, rightHip);
      [leftShoulder, rightShoulder, leftHip, rightHip].forEach(dot);
    };
    img.src = photo.dataUrl;
  }, [photo]);

  const rows: Array<{ label: string; value: string }> = [
    { label: "Shoulder width", value: `${measurements.shoulder_width.toFixed(1)} cm` },
    { label: "Chest width", value: `${measurements.chest_width.toFixed(1)} cm` },
    { label: "Chest circumference", value: `${measurements.chest_circumference.toFixed(1)} cm` },
    { label: "Waist width", value: `${measurements.waist_width.toFixed(1)} cm` },
    { label: "Waist circumference", value: `${measurements.waist.toFixed(1)} cm` },
    { label: "Hip width", value: `${measurements.hip_width.toFixed(1)} cm` },
    { label: "Hip circumference", value: `${measurements.hip.toFixed(1)} cm` },
  ];

  return (
    <div className="flex flex-col items-center gap-4 w-full max-w-md mx-auto">
      <canvas ref={canvasRef} className="rounded-2xl shadow-lg w-full" />

      <div className="w-full divide-y divide-neutral-200 dark:divide-neutral-700 border border-neutral-200 dark:border-neutral-700 rounded-xl overflow-hidden">
        {rows.map((r) => (
          <div key={r.label} className="flex justify-between items-baseline px-4 py-3">
            <p className="font-medium">{r.label}</p>
            <p className="text-lg font-semibold tabular-nums">{r.value}</p>
          </div>
        ))}
      </div>

      <button
        onClick={onStartOver}
        className="w-full py-3 rounded-xl font-semibold text-white bg-neutral-900 dark:bg-white dark:text-neutral-900"
      >
        Start over
      </button>
    </div>
  );
}
