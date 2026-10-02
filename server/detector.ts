// Open-vocabulary part detection (Grounding DINO, OWLv2 or similar) on a hosted endpoint, used to pre-draw boxes on
// the labeling screen instead of asking the chat AI. Configured with DETECTOR_URL (and DETECTOR_TOKEN if the endpoint
// needs one). The request and answer follow Hugging Face's zero-shot object detection format, which a Hugging Face
// Inference Endpoint running IDEA-Research/grounding-dino-base or google/owlv2-base-patch16-ensemble serves as is:
//   request:  { inputs: <base64 image>, parameters: { candidate_labels: ["brake rotor", ...] } }
//   answer:   [{ score, label, box: { xmin, ymin, xmax, ymax } }]   (pixels, or fractions of the photo)
// When the detector isn't set up or fails, callers fall back to the chat AI.
import { env, HttpError } from './lib';

export const detectorConfigured = () => !!env('DETECTOR_URL');
const minScore = () => { const n = Number(env('DETECTOR_MIN_SCORE')); return Number.isFinite(n) && n > 0 && n < 1 ? n : 0.25; };

/** Width and height from a JPEG or PNG header (null for anything else). */
export function imageSize(b: Uint8Array): { w: number; h: number } | null {
  if (b.length > 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
    return { w: v.getUint32(16), h: v.getUint32(20) };
  }
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const marker = b[i + 1];
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
      const len = (b[i + 2] << 8) | b[i + 3];
      // Start-of-frame markers carry the size (C0–CF, except C4 DHT, C8 JPG and CC DAC).
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { h: (b[i + 5] << 8) | b[i + 6], w: (b[i + 7] << 8) | b[i + 8] };
      }
      i += 2 + len;
    }
  }
  return null;
}

interface Detection { score: number; label: string; box: { xmin: number; ymin: number; xmax: number; ymax: number } }
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * Boxes for the given parts, as fractions of the photo. Each part gets the best-scoring unused box whose label is
 * its part type (two left/right parts of one type take the two best boxes in order). Throws if the endpoint fails.
 */
export async function detectParts(image: { bytes: Uint8Array; type: string }, parts: { key: string; label: string }[]): Promise<{ key: string; x: number; y: number; w: number; h: number }[]> {
  const labels = [...new Set(parts.map((p) => norm(p.label)))].filter(Boolean);
  if (!labels.length) return [];
  const headers: Record<string, string> = { 'content-type': 'application/json', accept: 'application/json' };
  if (env('DETECTOR_TOKEN')) headers.authorization = `Bearer ${env('DETECTOR_TOKEN')}`;
  let r: Response;
  try {
    r = await fetch(env('DETECTOR_URL')!, {
      method: 'POST', headers, signal: AbortSignal.timeout(25_000),
      body: JSON.stringify({ inputs: Buffer.from(image.bytes).toString('base64'), parameters: { candidate_labels: labels, threshold: minScore() } }),
    });
  } catch { throw new HttpError(502, 'Couldn’t reach the part detector.'); }
  if (!r.ok) throw new HttpError(502, `The part detector returned an error (${r.status}).`);
  const body = (await r.json()) as unknown;
  const list = (Array.isArray(body) ? (Array.isArray(body[0]) ? body[0] : body) : ((body as { detections?: unknown[] })?.detections ?? [])) as Detection[];
  const dets = list.filter((d) => d && typeof d.score === 'number' && d.score >= minScore() && typeof d.label === 'string' && d.box
    && [d.box.xmin, d.box.ymin, d.box.xmax, d.box.ymax].every((n) => typeof n === 'number' && Number.isFinite(n)) && d.box.xmax > d.box.xmin && d.box.ymax > d.box.ymin)
    .sort((a, b) => b.score - a.score);
  // Pixels or fractions: if any coordinate is over 1, scale by the photo's size.
  const pixels = dets.some((d) => d.box.xmax > 1.0001 || d.box.ymax > 1.0001);
  const size = pixels ? imageSize(image.bytes) : { w: 1, h: 1 };
  if (!size || !size.w || !size.h) return [];
  const used = new Set<Detection>();
  const out: { key: string; x: number; y: number; w: number; h: number }[] = [];
  for (const p of parts) {
    const want = norm(p.label);
    const d = dets.find((x) => !used.has(x) && norm(x.label) === want);
    if (!d) continue;
    used.add(d);
    const x = Math.min(Math.max(d.box.xmin / size.w, 0), 0.995), y = Math.min(Math.max(d.box.ymin / size.h, 0), 0.995);
    out.push({ key: p.key, x, y, w: Math.min(d.box.xmax / size.w, 1) - x, h: Math.min(d.box.ymax / size.h, 1) - y });
  }
  return out.filter((b) => b.w > 0 && b.h > 0);
}
