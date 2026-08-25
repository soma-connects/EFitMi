import type { Measurements } from "./types";

const API_BASE =
  process.env.NEXT_PUBLIC_MEASUREMENT_API_URL ?? "http://localhost:8001";

export class MeasurementApiError extends Error {}

async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const res = await fetch(dataUrl);
  return res.blob();
}

export async function requestMeasurements(
  photoDataUrl: string,
  cardBoxWidthPx: number,
): Promise<Measurements> {
  const blob = await dataUrlToBlob(photoDataUrl);
  const formData = new FormData();
  formData.append("front", blob, "front.jpg");
  formData.append("card_box_width_px", String(cardBoxWidthPx));

  let res: Response;
  try {
    res = await fetch(`${API_BASE}/measure`, { method: "POST", body: formData });
  } catch {
    throw new MeasurementApiError(
      `Could not reach the measurement service at ${API_BASE}. Is it running?`,
    );
  }

  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new MeasurementApiError(body?.error ?? `Measurement request failed (${res.status})`);
  }
  return body.measurements as Measurements;
}
