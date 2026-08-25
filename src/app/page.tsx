"use client";

import { useState } from "react";
import CaptureStep from "@/components/CaptureStep";
import CalibrateStep from "@/components/CalibrateStep";
import ResultsStep from "@/components/ResultsStep";
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

  function reset() {
    setPhoto(null);
    setMeasurements(null);
    setError(null);
    setStep("intro");
  }

  async function handleConfirmCard(cardBoxWidthPx: number) {
    if (!photo) return;
    setSubmitting(true);
    setError(null);
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
    <main className="flex-1 flex flex-col items-center justify-center px-4 py-8 gap-6">
      <header className="text-center">
        <h1 className="text-2xl font-bold tracking-tight">EFitMi</h1>
        <p className="text-sm text-neutral-500">
          Guided photo → body measurements
        </p>
      </header>

      {step === "intro" && (
        <div className="flex flex-col items-center gap-4 max-w-md text-center">
          <p className="text-neutral-600 dark:text-neutral-300">
            Stand facing your camera and hold a bank card (ATM/debit card)
            flat against your chest. We use the card&apos;s known size to
            calibrate real-world measurements from the photo.
          </p>
          <button
            onClick={() => setStep("capture")}
            className="px-6 py-3 rounded-xl font-semibold text-white bg-neutral-900 dark:bg-white dark:text-neutral-900"
          >
            Start
          </button>
        </div>
      )}

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
        <ResultsStep photo={photo} measurements={measurements} onStartOver={reset} />
      )}
    </main>
  );
}
