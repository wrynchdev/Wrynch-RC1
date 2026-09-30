// Stand-in for the vision model. Deterministic so demos and tests are repeatable.
// Swap `analyzePhotos` / `suggestWording` for real model calls later; the rest of the app only
// ever sees AI output as *pending* proposals that a technician must confirm (rules R4, R10–R12).
import { cls, compKey, parseKey, pointComponents, sections } from './ontology';
import { filterByCorner, type Corner } from './corner';
import type { AiObservation, Finding, Media, Severity, VehicleConfig, CompKey, PointNote, Template } from './types';

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

/** What the AI reports for one photo: every part it can see and the condition of each. Same shape from Claude or the stand-in. */
export interface PartReading {
  key: CompKey;
  confidence: number;
  condition: 'looks_ok' | 'concern' | 'unclear';
  note: string;
  findings: { key: string; severity: Severity; confidence: number; rationale: string }[];
}
export interface PhotoAnalysis { mediaId: string; parts: PartReading[] }

/** Parts a photo from this stage could show on this vehicle (photo-capable parts only). */
export function stageTargets(sectionId: string, config: VehicleConfig, template?: Template, pointId?: string | null, corner?: Corner | null): CompKey[] {
  const section = (template ? template.sections : sections()).find((s) => s.id === sectionId);
  if (!section) throw new Error(`Unknown section ${sectionId}`);
  const out: CompKey[] = [];
  for (const p of section.points.filter((x) => !pointId || x.id === pointId)) {
    for (const c of pointComponents(p, config)) {
      if (c.applies && !out.includes(c.key) && cls(parseKey(c.key).classId).aiPhoto !== 'no') out.push(c.key);
    }
  }
  return filterByCorner(out, (k) => k, corner);
}

/**
 * Deterministic stand-in for the vision model: each photo "shows" one to three neighbouring parts at the same
 * position, most look OK, some get a typical finding, and about one in six can't be identified.
 */
export function analyzePhotos(sectionId: string, files: { id: string; name: string }[], config: VehicleConfig, template?: Template, pointId?: string | null, corner?: Corner | null): PhotoAnalysis[] {
  const targets = stageTargets(sectionId, config, template, pointId, corner);
  return files.map((f, i) => {
    const h = hash(`${f.name}:${i}`);
    const confidence = 0.5 + ((h >>> 3) % 50) / 100; // 0.50–0.99
    if (!targets.length || confidence < 0.58) return { mediaId: f.id, parts: [] };
    // Spread photos over the stage by file name, so the result doesn't depend on how photos are batched.
    const first = targets[(hash(f.name) >>> 5) % targets.length];
    const pos = parseKey(first).position;
    const nearby = targets.filter((k) => k !== first && parseKey(k).position === pos).slice(0, h % 3);
    const parts = [first, ...nearby].map((key, j): PartReading => {
      const favs = FAVOURITES[cls(parseKey(key).classId).name];
      const concern = !!favs && (h >> j) % 3 === 0;
      const fav = favs?.[(h >> j) % favs.length];
      const allowed = fav && cls(parseKey(key).classId).findings[fav[0]];
      return {
        key, confidence: Math.round((confidence - j * 0.05) * 100) / 100,
        condition: concern && allowed ? 'concern' : 'looks_ok',
        note: concern && allowed ? 'Stand-in model: confirm against the part itself.' : 'No visible damage, leaks or wear in the photo (stand-in model).',
        findings: concern && allowed ? [{ key: fav![0], severity: fav![1], confidence: Math.round((0.7 + (h % 25) / 100) * 100) / 100,
          rationale: `Suggested from photo "${f.name}". Stand-in model: confirm against the part itself.` }] : [],
      };
    });
    return { mediaId: f.id, parts };
  });
}

/**
 * Store an analysis as pending suggestions (demo mode; the server does the same in ai_record_sort).
 * Links start ai_proposed, "looks OK" becomes a pending observation, problems become pending findings.
 */
export function applyAnalysis(insp: { media: Media[]; findings: Finding[]; observations: AiObservation[] }, analyses: PhotoAnalysis[]) {
  for (const a of analyses) {
    const m = insp.media.find((x) => x.id === a.mediaId);
    if (!m || m.excluded || m.analyzed || m.links.length) continue;
    m.analyzed = true;
    for (const p of a.parts) {
      if (m.links.some((l) => l.compKey === p.key)) continue;
      m.links.push({ compKey: p.key, status: 'ai_proposed', confidence: p.confidence });
      if (p.condition === 'looks_ok') {
        insp.observations.push({ id: `obs-${a.mediaId}-${p.key}`, mediaId: a.mediaId, compKey: p.key, verdict: 'looks_ok', note: p.note, confidence: p.confidence, status: 'pending' });
      }
      for (const f of p.findings) {
        if (!cls(parseKey(p.key).classId).findings[f.key]) continue;
        insp.findings.push({ id: `ai-${a.mediaId}-${p.key}-${f.key}`, compKey: p.key, key: f.key, severity: f.severity, source: 'ai', status: 'pending',
          confidence: f.confidence, rationale: f.rationale, mediaId: a.mediaId, reviewedAt: null, aiOriginal: { key: f.key, severity: f.severity } });
      }
    }
  }
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
