"use client";

import { useEffect, useRef, useState } from "react";
import type { NormalizedLandmark, PoseLandmarker } from "@mediapipe/tasks-vision";
import { getPoseLandmarker } from "@/lib/pose";
import { checkFraming, sampleBrightness } from "@/lib/measurements";
import type { CapturedPhoto } from "@/lib/types";
import { CARD_ASPECT } from "@/lib/constants";

const BRIGHTNESS_SAMPLE_SIZE = 64;

export default function CaptureStep({
  onCapture,
}: {
  onCapture: (photo: CapturedPhoto) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const brightnessCanvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const latestLandmarksRef = useRef<NormalizedLandmark[] | null>(null);

  const [modelReady, setModelReady] = useState(false);
  const [ok, setOk] = useState(false);
  const [reasons, setReasons] = useState<string[]>(["Loading camera…"]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function start() {
      let landmarker: PoseLandmarker;
      let stream: MediaStream;
      try {
        [landmarker, stream] = await Promise.all([
          getPoseLandmarker().catch((err) => {
            throw new Error(
              `Could not load the pose model: ${err instanceof Error ? err.message : String(err)}`,
            );
          }),
          navigator.mediaDevices
            .getUserMedia({
              video: { facingMode: "user", width: 1280, height: 960 },
              audio: false,
            })
            .catch((err) => {
              throw new Error(
                `Could not access the camera: ${err instanceof Error ? err.message : String(err)}`,
              );
            }),
        ]);

        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        setModelReady(true);

        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play();

        const brightnessCanvas = brightnessCanvasRef.current;
        const bctx = brightnessCanvas?.getContext("2d", {
          willReadFrequently: true,
        });

        let lastUiUpdate = 0;
        const loop = () => {
          if (cancelled || !video.videoWidth) {
            rafRef.current = requestAnimationFrame(loop);
            return;
          }

          const result = landmarker.detectForVideo(video, performance.now());
          const landmarks = result.landmarks[0] ?? null;
          latestLandmarksRef.current = landmarks;

          let brightness = 255;
          if (bctx && brightnessCanvas) {
            bctx.drawImage(
              video,
              0,
              0,
              BRIGHTNESS_SAMPLE_SIZE,
              BRIGHTNESS_SAMPLE_SIZE,
            );
            brightness = sampleBrightness(
              bctx,
              BRIGHTNESS_SAMPLE_SIZE,
              BRIGHTNESS_SAMPLE_SIZE,
            );
          }

          const framing = checkFraming(landmarks, brightness);

          const now = performance.now();
          if (now - lastUiUpdate > 120) {
            lastUiUpdate = now;
            setOk(framing.ok);
            setReasons(framing.reasons);
          }

          rafRef.current = requestAnimationFrame(loop);
        };
        rafRef.current = requestAnimationFrame(loop);
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error
              ? err.message
              : "Could not access the camera.",
          );
        }
      }
    }

    start();

    return () => {
      cancelled = true;
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  function handleCapture() {
    const video = videoRef.current;
    const landmarks = latestLandmarksRef.current;
    if (!video || !landmarks || !video.videoWidth) return;

    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());

    onCapture({
      dataUrl: canvas.toDataURL("image/jpeg", 0.92),
      width: canvas.width,
      height: canvas.height,
      landmarks,
    });
  }

  return (
    <div className="flex flex-col items-center gap-4 w-full max-w-md mx-auto">
      <div className="relative w-full aspect-[3/4] bg-black rounded-2xl overflow-hidden shadow-lg">
        <video
          ref={videoRef}
          playsInline
          muted
          className="absolute inset-0 w-full h-full object-cover -scale-x-100"
        />
        <canvas
          ref={brightnessCanvasRef}
          width={BRIGHTNESS_SAMPLE_SIZE}
          height={BRIGHTNESS_SAMPLE_SIZE}
          className="hidden"
        />

        {/* Guide overlay: body silhouette + card position at chest height */}
        <svg
          viewBox="0 0 300 400"
          className="absolute inset-0 w-full h-full pointer-events-none"
        >
          <ellipse
            cx="150"
            cy="70"
            rx="38"
            ry="46"
            fill="none"
            stroke={ok ? "#4ade80" : "white"}
            strokeOpacity="0.6"
            strokeWidth="2"
            strokeDasharray="6 6"
          />
          <path
            d="M 90 260 L 78 130 Q 150 95 222 130 L 210 260 Q 150 300 90 260 Z"
            fill="none"
            stroke={ok ? "#4ade80" : "white"}
            strokeOpacity="0.6"
            strokeWidth="2"
            strokeDasharray="6 6"
          />
          <line
            x1="150"
            y1="300"
            x2="150"
            y2="390"
            stroke={ok ? "#4ade80" : "white"}
            strokeOpacity="0.3"
            strokeWidth="2"
            strokeDasharray="4 8"
          />
          {/* Card guide at chest height, ID-1 aspect ratio */}
          <rect
            x={150 - 45}
            y={175}
            width={90}
            height={90 / CARD_ASPECT}
            rx="4"
            fill="none"
            stroke="#facc15"
            strokeWidth="2.5"
          />
          <text
            x="150"
            y={175 + 90 / CARD_ASPECT + 16}
            textAnchor="middle"
            fill="#facc15"
            fontSize="11"
          >
            hold card here
          </text>
        </svg>
      </div>

      <div className="min-h-[3rem] text-center text-sm">
        {error ? (
          <p className="text-red-500">{error}</p>
        ) : !modelReady ? (
          <p className="text-neutral-400">Loading pose model…</p>
        ) : ok ? (
          <p className="text-green-500 font-medium">
            Looking good — hold the card up and capture
          </p>
        ) : (
          <ul className="text-amber-500 space-y-0.5">
            {reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        )}
      </div>

      <button
        onClick={handleCapture}
        disabled={!ok}
        className="w-full py-3 rounded-xl font-semibold text-white bg-neutral-900 disabled:bg-neutral-300 disabled:text-neutral-500 dark:bg-white dark:text-neutral-900 dark:disabled:bg-neutral-700 dark:disabled:text-neutral-400 transition-colors"
      >
        Capture
      </button>
    </div>
  );
}
