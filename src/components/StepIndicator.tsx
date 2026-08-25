"use client";

import type { Step } from "@/lib/types";

const ORDER: Step[] = ["capture", "calibrate", "results"];
const LABELS: Record<string, string> = {
  capture: "Capture",
  calibrate: "Calibrate",
  results: "Results",
};

export default function StepIndicator({ current }: { current: Step }) {
  if (current === "intro") return null;
  const activeIndex = ORDER.indexOf(current);

  return (
    <ol className="flex items-center gap-2 w-full max-w-md" aria-label="Progress">
      {ORDER.map((step, i) => {
        const done = i < activeIndex;
        const active = i === activeIndex;
        return (
          <li key={step} className="flex-1 flex flex-col gap-1.5">
            <div
              className={`h-1 rounded-full transition-colors ${
                done || active
                  ? "bg-neutral-900 dark:bg-white"
                  : "bg-neutral-200 dark:bg-neutral-700"
              }`}
            />
            <span
              className={`text-xs ${
                active
                  ? "text-neutral-900 dark:text-white font-medium"
                  : "text-neutral-400"
              }`}
              aria-current={active ? "step" : undefined}
            >
              {LABELS[step]}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
