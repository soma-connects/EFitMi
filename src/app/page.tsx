"use client";

import { useEffect, useRef, useState } from "react";
import CaptureStep from "@/components/CaptureStep";
import CalibrateStep from "@/components/CalibrateStep";
import ResultsStep from "@/components/ResultsStep";
import IntroStep from "@/components/IntroStep";
import StepIndicator from "@/components/StepIndicator";
import { computeMeasurements } from "@/lib/measure";
import type { CapturedPhoto, Measurements, Step } from "@/lib/types";

/** Decodes the captured photo back to raw pixels for the contour scan. */
function loadImageData(
  dataUrl: string,
  width: number,
  height: number,
): Promise<ImageData> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) {
        reject(new Error("Could not read the captured photo."));
        return;
      }
      ctx.drawImage(img, 0, 0, width, height);
      resolve(ctx.getImageData(0, 0, width, height));
    };
    img.onerror = () => reject(new Error("Could not read the captured photo."));
    img.src = dataUrl;
  });
}

export default function Home() {
  const [step, setStep] = useState<Step>("intro");
  const [photo, setPhoto] = useState<CapturedPhoto | null>(null);
  const [measurements, setMeasurements] = useState<Measurements | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cardAdjusted, setCardAdjusted] = useState(true);
  const stepRegionRef = useRef<HTMLDivElement>(null);

  // Each step swaps the whole screen without navigating, so focus would
  // otherwise stay on the button that was just clicked (or be lost entirely
  // when that button unmounts). Move it to the new step's container so
  // keyboard and screen-reader users land where the content is.
  useEffect(() => {
    if (step === "intro") return;
    stepRegionRef.current?.focus();
  }, [step]);

  function reset() {
    setPhoto(null);
    setMeasurements(null);
    setError(null);
    setStep("intro");
  }

  async function handleConfirmCard(cardBoxWidthPx: number, adjusted: boolean) {
    if (!photo) return;
    setSubmitting(true);
    setError(null);
    setCardAdjusted(adjusted);
    try {
      const image = await loadImageData(photo.dataUrl, photo.width, photo.height);
      setMeasurements(computeMeasurements(photo.landmarks, image, cardBoxWidthPx));
      setStep("results");
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Something went wrong getting your measurements. Please try again.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="flex-1 flex flex-col items-center px-4 py-8 gap-6">
      <header className="text-center">
        <h1 className="text-2xl font-bold tracking-tight">EFitMi</h1>
        <p className="text-sm text-neutral-500">
          Guided photo → body measurements
        </p>
      </header>

      <StepIndicator current={step} />

      <div
        ref={stepRegionRef}
        tabIndex={-1}
        aria-live="polite"
        className="w-full flex flex-col items-center outline-none"
      >
      {step === "intro" && <IntroStep onStart={() => setStep("capture")} />}

      {step === "capture" && (
        <CaptureStep
          onCapture={(p) => {
            setPhoto(p);
            setStep("calibrate");
          }}
        />
      )}

      {step === "calibrate" && photo && (
        <CalibrateStep
          photo={photo}
          submitting={submitting}
          error={error}
          onRetake={() => {
            setPhoto(null);
            setError(null);
            setStep("capture");
          }}
          onConfirm={handleConfirmCard}
        />
      )}

      {step === "results" && photo && measurements && (
        <ResultsStep
          photo={photo}
          measurements={measurements}
          cardAdjusted={cardAdjusted}
          onStartOver={reset}
          onAdjustCard={() => setStep("calibrate")}
        />
      )}
      </div>
    </main>
  );
}
