// Training data for a part-detection model: boxes around confirmed parts on photos, and the export in the
// YOLO format (one class per part type; the side of the car is not a visual class, so position is kept as metadata).
import { cls, compLabel, parseKey } from './ontology';
import type { CompKey } from './types';

/** A box in fractions of the photo (0..1), top-left corner plus size. */
export interface TrainingBox { classId: number; position: string | null; x: number; y: number; w: number; h: number; source: 'ai' | 'human' }
export interface ExportRow { mediaId: string; url: string; width: number | null; height: number | null; boxes: TrainingBox[] }
export interface YoloManifest {
  format: 'wrynch-yolo-1';
  createdAt: string;
  classes: { index: number; classId: number; name: string; label: string }[];
  images: { id: string; url: string; width: number | null; height: number | null; split: 'train' | 'val'; labels: [number, number, number, number, number][] }[];
}

const MIN = 0.005;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const round = (n: number) => Math.round(n * 1e5) / 1e5;

/** Keep a box inside the photo with a sensible minimum size. */
export function clampBox<T extends Pick<TrainingBox, 'x' | 'y' | 'w' | 'h'>>(b: T): T {
  const x = clamp(b.x, 0, 1 - MIN), y = clamp(b.y, 0, 1 - MIN);
  return { ...b, x: round(x), y: round(y), w: round(clamp(b.w, MIN, 1 - x)), h: round(clamp(b.h, MIN, 1 - y)) };
}
export const validBox = (b: Partial<TrainingBox>) =>
  [b.x, b.y, b.w, b.h].every((n) => typeof n === 'number' && Number.isFinite(n))
  && b.x! >= 0 && b.y! >= 0 && b.w! > 0 && b.h! > 0 && b.x! + b.w! <= 1.0001 && b.y! + b.h! <= 1.0001 && typeof b.classId === 'number';

/** The parts a technician confirmed on a photo, as the choices for its boxes. */
export const labelParts = (keys: CompKey[]) => keys.map((key) => ({ key, classId: parseKey(key).classId, position: parseKey(key).position, label: compLabel(key, true) }));

/** Stable 90/10 train/validation split by photo, so a photo never moves between sets across exports. */
export function splitOf(id: string): 'train' | 'val' {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) % 10 === 0 ? 'val' : 'train';
}

/** The export: classes numbered 0..n-1 by part type, and each photo's boxes as YOLO rows [class, cx, cy, w, h]. */
export function toYoloManifest(rows: ExportRow[], now = new Date()): YoloManifest {
  const ids = [...new Set(rows.flatMap((r) => r.boxes.map((b) => b.classId)))].sort((a, b) => a - b);
  const index = new Map(ids.map((id, i) => [id, i]));
  return {
    format: 'wrynch-yolo-1',
    createdAt: now.toISOString(),
    classes: ids.map((classId, i) => ({ index: i, classId, name: cls(classId).name, label: cls(classId).label })),
    images: rows.map((r) => ({
      id: r.mediaId, url: r.url, width: r.width, height: r.height, split: splitOf(r.mediaId),
      labels: r.boxes.filter(validBox).map((b) => [index.get(b.classId)!, round(b.x + b.w / 2), round(b.y + b.h / 2), round(b.w), round(b.h)] as [number, number, number, number, number]),
    })),
  };
}

/** How many approved boxes a part type needs before a model usually learns it well. */
export const TARGET_PER_CLASS = 300;
