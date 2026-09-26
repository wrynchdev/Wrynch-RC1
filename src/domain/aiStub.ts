// Stand-in for the vision model. Deterministic so demos and tests are repeatable.
// Swap `sortPhotos` / `suggestWording` for real model calls later; the rest of the app only
// ever sees AI output as *pending* proposals that a technician must confirm (rules R4, R10–R12).
import { cls, compKey, parseKey, pointComponents, sections } from './ontology';
import type { Finding, Media, Severity, VehicleConfig, CompKey, PointNote } from './types';

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/** Findings the stub likes to suggest for a class, most "demo-worthy" first. */
const FAVOURITES: Record<string, [string, Severity][]> = {
  brake_rotor: [['grooved', 'moderate'], ['scored', 'minor']],
  shock_absorber: [['seepage', 'minor']],
  strut_assembly: [['seepage', 'minor']],
  ball_joint: [['damaged_seal', 'moderate']],
  outer_tie_rod_end: [['damaged_seal', 'minor']],
  tire: [['dry_rot', 'moderate'], ['uneven_wear', 'minor']],
  cv_boot: [['crack', 'minor']],
  exhaust_pipe: [['rust', 'minor']],
  coil_spring: [['rust', 'minor']],
};

export interface SortResult { media: Media[]; findings: Finding[] }

/** Place each photo on a component in the section and maybe propose a finding. */
export function sortPhotos(
  sectionId: string, files: { id: string; url: string; name: string }[], config: VehicleConfig, now: string,
): SortResult {
  const section = sections().find((s) => s.id === sectionId);
  if (!section) throw new Error(`Unknown section ${sectionId}`);
  const targets: { pointId: string; key: CompKey }[] = [];
  for (const p of section.points) {
    for (const c of pointComponents(p, config)) {
      if (c.applies && cls(parseKey(c.key).classId).aiPhoto !== 'no') targets.push({ pointId: p.id, key: c.key });
    }
  }
  const media: Media[] = [];
  const findings: Finding[] = [];
  files.forEach((f, i) => {
    const h = hash(`${f.name}:${i}`);
    const t = targets[(i * 7 + (h % 3)) % Math.max(1, targets.length)];
    const confidence = 0.5 + ((h >>> 3) % 50) / 100; // 0.50–0.99
    const unsure = !t || confidence < 0.58; // roughly 1 in 6 photos waits for the tech
    media.push({
      id: f.id, sectionId, url: f.url, label: f.name,
      pointId: unsure ? null : t.pointId, compKey: unsure ? null : t.key,
      status: unsure ? 'unassigned' : 'ai_proposed', confidence: Math.round(confidence * 100) / 100,
      aiGuess: t ? { pointId: t.pointId, compKey: t.key } : null,
      history: [{ at: now, status: unsure ? 'unassigned' : 'ai_proposed', compKey: unsure ? null : t.key }],
      customerVisible: true,
    });
    if (unsure) return;
    const favs = FAVOURITES[cls(parseKey(t.key).classId).name];
    if (favs && h % 3 === 0 && !findings.some((x) => x.compKey === t.key)) {
      const [key, severity] = favs[h % favs.length];
      if (cls(parseKey(t.key).classId).findings[key]) {
        findings.push({
          id: `ai-${f.id}`, compKey: t.key, key, severity, source: 'ai', status: 'pending',
          confidence: Math.round((0.7 + (h % 25) / 100) * 100) / 100,
          rationale: `Suggested from photo "${f.name}". Stub model: confirm against the part itself.`,
          mediaId: f.id, reviewedAt: null, aiOriginal: { key, severity },
        });
      }
    }
  });
  return { media, findings };
}

const ABBR: [RegExp, string][] = [
  [/\bLF\b/gi, 'left front'], [/\bRF\b/gi, 'right front'], [/\bLR\b/gi, 'left rear'], [/\bRR\b/gi, 'right rear'],
  [/\bfronts\b/gi, 'the front ones'], [/\brears\b/gi, 'the rear ones'], [/\bw\/\b/gi, 'with'], [/\bCEL\b/g, 'check engine light'],
];

/**
 * Customer-friendly rewrite of a technician note. It may only reword: numbers in the note must all
 * survive, and no new numbers may appear (checked by `wordingKeepsFacts`).
 */
export function suggestWording(note: PointNote): string {
  let t = note.techText.trim();
  for (const [re, rep] of ABBR) t = t.replace(re, rep);
  t = t.replace(/(\d)\s*mm\b/g, '$1 mm').replace(/\s*\/\s*/g, '; ');
  const sentences = t.split(/(?<=[.;])\s+/).map((s) => s.trim()).filter(Boolean)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1));
  let out = sentences.join(' ').replace(/;\s*$/, '.');
  if (!/[.!?]$/.test(out)) out += '.';
  return out;
}

const nums = (s: string) => (s.match(/\d+(?:[.,/]\d+)*/g) ?? []).sort();
/** Guardrail: the suggestion keeps every measurement and adds none. */
export function wordingKeepsFacts(original: string, suggestion: string): boolean {
  return JSON.stringify(nums(original)) === JSON.stringify(nums(suggestion));
}

export { compKey };
