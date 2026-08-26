"use client";

import { CARD_ASPECT } from "@/lib/constants";

/**
 * How the user stands and holds the card is the largest source of error in
 * the whole pipeline, so the instructions are the product here, not padding.
 */
const STEPS = [
  {
    title: "Press the card flat against your chest",
    body: "Any ATM, debit or credit card — they're all the same size worldwide. It must touch your body: held out in your hands it sits closer to the camera, looks bigger than it is, and makes every measurement come out too small.",
  },
  {
    title: "Keep the card square to the camera",
    body: "Tilted away, it looks narrower than it is, which pushes every measurement the other way — too large.",
  },
  {
    title: "Stand square, arms slightly out",
    body: "Face the camera straight on, feet planted, and let your arms hang a little away from your body.",
  },
  {
    title: "Get your head to your hips in frame",
    body: "Prop the phone up a couple of steps back. Use the timer if you can't reach the button.",
  },
];

export default function IntroStep({ onStart }: { onStart: () => void }) {
  return (
    <div className="flex flex-col items-center gap-6 w-full max-w-md">
      <div className="text-center space-y-2">
        <p className="text-neutral-600 dark:text-neutral-300">
          Take one guided photo holding a bank card, and get back estimated
          body measurements — calibrated against the card&apos;s known size.
        </p>
      </div>

      {/* Card illustration, drawn at true ID-1 proportions. */}
      <div className="flex items-center justify-center gap-4 py-1">
        <div
          className="rounded-lg border-2 border-yellow-400 bg-yellow-400/10 flex items-center justify-center shrink-0"
          style={{ width: 104, height: 104 / CARD_ASPECT }}
        >
          <span className="text-[10px] text-yellow-600 dark:text-yellow-400 font-medium">
            85.6 × 54 mm
          </span>
        </div>
        <p className="text-sm text-neutral-500">
          Every bank card is exactly this size — that&apos;s the ruler.
        </p>
      </div>

      <ol className="w-full space-y-3">
        {STEPS.map((s, i) => (
          <li key={s.title} className="flex gap-3">
            <span className="shrink-0 w-6 h-6 rounded-full bg-neutral-900 text-white dark:bg-white dark:text-neutral-900 text-xs font-semibold flex items-center justify-center mt-0.5">
              {i + 1}
            </span>
            <div>
              <p className="font-medium leading-tight">{s.title}</p>
              <p className="text-sm text-neutral-500 mt-0.5">{s.body}</p>
            </div>
          </li>
        ))}
      </ol>

      <button
        onClick={onStart}
        className="w-full py-3 rounded-xl font-semibold text-white bg-neutral-900 dark:bg-white dark:text-neutral-900"
      >
        Start
      </button>

      <p className="text-xs text-neutral-500 text-center">
        Everything runs on your device. The photo is never uploaded, and
        nothing is saved once you close the page.
      </p>
    </div>
  );
}
