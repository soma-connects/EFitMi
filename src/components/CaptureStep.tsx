"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { NormalizedLandmark, PoseLandmarker } from "@mediapipe/tasks-vision";
import { getPoseLandmarker } from "@/lib/pose";
import { checkFraming, sampleBrightness } from "@/lib/measurements";
import type { CapturedPhoto } from "@/lib/types";
import { CARD_ASPECT } from "@/lib/constants";

const BRIGHTNESS_SAMPLE_SIZE = 64;
const COUNTDOWN_SECONDS = 5;

type Facing = "user" | "environment";

/** Turns a getUserMedia failure into something a user can act on. */
function cameraErrorMessage(err: unknown): string {
  const name = err instanceof DOMException ? err.name : "";
  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
      return "Camera access was blocked. Allow camera access for this site in your browser settings, then reload.";
    case "NotFoundError":
    case "OverconstrainedError":
      return "No camera found. If your device has one, check nothing else is using it.";
    case "NotReadableError":
      return "The camera is in use by another app. Close it and reload.";
    default:
      if (
        typeof window !== "undefined" &&
        !window.isSecureContext
      ) {
        return "Camera access needs a secure (https) connection.";
      }
      return err instanceof Error
        ? `Could not access the camera: ${err.message}`
        : "Could not access the camera.";
  }
}

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
  const latestWorldRef = useRef<NormalizedLandmark[] | null>(null);
  const okRef = useRef(false);

  const [facing, setFacing] = useState<Facing>("user");
  const [hasMultipleCameras, setHasMultipleCameras] = useState(false);
  const [modelReady, setModelReady] = useState(false);
  const [ok, setOk] = useState(false);
  const [reasons, setReasons] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);

  const stopStream = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const takePhoto = useCallback(() => {
    const video = videoRef.current;
    const landmarks = latestLandmarksRef.current;
    if (!video || !landmarks || !video.videoWidth) return;

    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    stopStream();
    onCapture({
      dataUrl: canvas.toDataURL("image/jpeg", 0.92),
      width: canvas.width,
      height: canvas.height,
      landmarks,
      worldLandmarks: latestWorldRef.current ?? undefined,
    });
  }, [onCapture, stopStream]);

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
              video: { facingMode: facing, width: 1280, height: 960 },
              audio: false,
            })
            .catch((err) => {
              throw new Error(cameraErrorMessage(err));
            }),
        ]);

        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        setModelReady(true);
        setError(null);

        navigator.mediaDevices
          .enumerateDevices()
          .then((devices) => {
            if (cancelled) return;
            const cams = devices.filter((d) => d.kind === "videoinput");
            setHasMultipleCameras(cams.length > 1);
          })
          .catch(() => {});

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
          latestWorldRef.current = result.worldLandmarks?.[0] ?? null;

          let brightness = 255;
          if (bctx && brightnessCanvas) {
            bctx.drawImage(video, 0, 0, BRIGHTNESS_SAMPLE_SIZE, BRIGHTNESS_SAMPLE_SIZE);
            brightness = sampleBrightness(
              bctx,
              BRIGHTNESS_SAMPLE_SIZE,
              BRIGHTNESS_SAMPLE_SIZE,
            );
          }

          const framing = checkFraming(landmarks, brightness);
          okRef.current = framing.ok;

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
          setError(err instanceof Error ? err.message : cameraErrorMessage(err));
        }
      }
    }

    start();
    return () => {
      cancelled = true;
      stopStream();
    };
  }, [facing, stopStream]);

  // Timed capture: you can't hold a card at chest height and tap a button at
  // the same time, so the countdown is the primary path on a phone.
  useEffect(() => {
    if (countdown === null) return;

    if (countdown === 0) {
      // Only fire if framing still holds at the moment of capture.
      if (okRef.current) takePhoto();
      else setCountdown(null);
      return;
    }

    // Each tick re-checks framing from the ref, so stepping out of frame
    // cancels the countdown instead of capturing a bad shot.
    const id = setTimeout(() => {
      setCountdown((c) => {
        if (c === null) return null;
        return okRef.current ? c - 1 : null;
      });
    }, 1000);
    return () => clearTimeout(id);
  }, [countdown, takePhoto]);

  const counting = countdown !== null;

  if (error) {
    return (
      <div className="flex flex-col items-center gap-4 w-full max-w-md mx-auto text-center">
        <div className="w-full rounded-xl border border-red-400/60 bg-red-50 dark:bg-red-950/40 p-4">
          <p className="font-semibold text-red-700 dark:text-red-300">
            Camera unavailable
          </p>
          <p className="text-sm text-red-700/90 dark:text-red-200/90 mt-1">
            {error}
          </p>
        </div>
        <button
          onClick={() => window.location.reload()}
          className="w-full py-3 rounded-xl font-semibold text-white bg-neutral-900 dark:bg-white dark:text-neutral-900"
        >
          Reload and try again
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-4 w-full max-w-md mx-auto">
      <div className="relative w-full aspect-[3/4] bg-black rounded-2xl overflow-hidden shadow-lg">
        <video
          ref={videoRef}
          playsInline
          muted
          className={`absolute inset-0 w-full h-full object-cover ${
            facing === "user" ? "-scale-x-100" : ""
          }`}
        />
        <canvas
          ref={brightnessCanvasRef}
          width={BRIGHTNESS_SAMPLE_SIZE}
          height={BRIGHTNESS_SAMPLE_SIZE}
          className="hidden"
        />

        <svg
          viewBox="0 0 300 400"
          className="absolute inset-0 w-full h-full pointer-events-none"
        >
          <ellipse
            cx="150" cy="70" rx="38" ry="46"
            fill="none" stroke={ok ? "#4ade80" : "white"} strokeOpacity="0.6"
            strokeWidth="2" strokeDasharray="6 6"
          />
          <path
            d="M 90 260 L 78 130 Q 150 95 222 130 L 210 260 Q 150 300 90 260 Z"
            fill="none" stroke={ok ? "#4ade80" : "white"} strokeOpacity="0.6"
            strokeWidth="2" strokeDasharray="6 6"
          />
          <line
            x1="150" y1="300" x2="150" y2="390"
            stroke={ok ? "#4ade80" : "white"} strokeOpacity="0.3"
            strokeWidth="2" strokeDasharray="4 8"
          />
          <rect
            x={150 - 45} y={175} width={90} height={90 / CARD_ASPECT}
            rx="4" fill="none" stroke="#facc15" strokeWidth="2.5"
          />
          <text
            x="150" y={175 + 90 / CARD_ASPECT + 16}
            textAnchor="middle" fill="#facc15" fontSize="11"
          >
            card flat on chest
          </text>
        </svg>

        {counting && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/30">
            <span className="text-8xl font-bold text-white drop-shadow-lg tabular-nums">
              {countdown === 0 ? "📸" : countdown}
            </span>
          </div>
        )}

        {hasMultipleCameras && !counting && (
          <button
            onClick={() => setFacing((f) => (f === "user" ? "environment" : "user"))}
            className="absolute top-3 right-3 px-3 py-1.5 rounded-full bg-black/60 text-white text-xs font-medium backdrop-blur"
          >
            Flip camera
          </button>
        )}
      </div>

      <div className="min-h-[3rem] text-center text-sm flex items-center justify-center">
        {!modelReady ? (
          <p className="text-neutral-400">Loading pose model…</p>
        ) : counting ? (
          <p className="text-neutral-500">Hold still — hold the card flat to the camera</p>
        ) : ok ? (
          <p className="text-green-500 font-medium">
            Looking good — press the card flat to your chest
          </p>
        ) : (
          <ul className="text-amber-500 space-y-0.5">
            {reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex gap-3 w-full">
        <button
          onClick={() => setCountdown(counting ? null : COUNTDOWN_SECONDS)}
          disabled={!ok && !counting}
          className="flex-1 py-3 rounded-xl font-medium border border-neutral-300 dark:border-neutral-600 disabled:opacity-40"
        >
          {counting ? "Cancel" : `${COUNTDOWN_SECONDS}s timer`}
        </button>
        <button
          onClick={takePhoto}
          disabled={!ok || counting}
          className="flex-1 py-3 rounded-xl font-semibold text-white bg-neutral-900 disabled:bg-neutral-300 disabled:text-neutral-500 dark:bg-white dark:text-neutral-900 dark:disabled:bg-neutral-700 dark:disabled:text-neutral-400 transition-colors"
        >
          Capture
        </button>
      </div>
    </div>
  );
}
