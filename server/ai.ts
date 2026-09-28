// Claude vision for photo sorting, and customer wording. Every AI answer is validated against the ontology
// and the shop template before it is stored, and everything stored is a pending proposal (rules R4, R10).
import { cls, compLabel, findingLabel, parseKey, pointComponents } from '../src/domain/ontology';
import { suggestWording, wordingKeepsFacts, type PartReading, type PhotoAnalysis } from '../src/domain/aiStub';
import type { CompKey, PointNote, Severity, Template, VehicleConfig } from '../src/domain/types';
import { env, HttpError } from './lib';

export interface Candidate { key: CompKey; stage: string; label: string; findings: string[] }

/**
 * Parts a photo could show on this vehicle: every photo-capable part in the template, not just the stage it was
 * taken in, so one photo can count for several inspection points. The photo's own stage is listed first.
 */
export function candidatesFor(template: Template, sectionId: string, config: VehicleConfig): Candidate[] {
  if (!template.sections.some((s) => s.id === sectionId)) throw new HttpError(400, `Unknown stage ${sectionId}`);
  const ordered = [...template.sections].sort((a, b) => (a.id === sectionId ? -1 : b.id === sectionId ? 1 : 0));
  const out = new Map<CompKey, Candidate>();
  for (const s of ordered) {
    for (const p of s.points) {
      for (const c of pointComponents(p, config)) {
        if (!c.applies || out.has(c.key)) continue;
        const k = cls(parseKey(c.key).classId);
        if (k.aiPhoto === 'no') continue;
        out.set(c.key, { key: c.key, stage: s.name, label: compLabel(c.key), findings: Object.keys(k.findings) });
      }
    }
  }
  return [...out.values()];
}

const SEVERITIES = ['minor', 'moderate', 'severe', 'critical'];
const CONDITIONS = ['looks_ok', 'concern', 'unclear'];
const clamp01 = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0);

/**
 * Turn raw model output into safe suggestions. A part not on the candidate list, a finding the ontology doesn't
 * allow for that part, or a low-confidence identification is dropped. "Looks OK" is kept only when there are no
 * findings; a concern with no valid finding becomes "unclear" (the photo is linked, nothing is claimed).
 */
export function validateAnalysis(mediaId: string, raw: unknown, candidates: Candidate[], minConfidence = 0.55): PhotoAnalysis {
  const out: PhotoAnalysis = { mediaId, parts: [] };
  const list = (raw as { parts?: unknown } | null)?.parts;
  if (!Array.isArray(list)) return out;
  for (const item of list.slice(0, 12)) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    const cand = candidates.find((c) => c.key === r.part);
    const confidence = clamp01(r.confidence);
    if (!cand || confidence < minConfidence || out.parts.some((p) => p.key === cand.key)) continue;
    const findings: PartReading['findings'] = [];
    for (const f of Array.isArray(r.findings) ? r.findings : []) {
      const x = f as Record<string, unknown>;
      if (typeof x?.key === 'string' && cand.findings.includes(x.key) && typeof x.severity === 'string' && SEVERITIES.includes(x.severity)
          && !findings.some((y) => y.key === x.key)) {
        findings.push({ key: x.key, severity: x.severity as Severity, confidence: clamp01(x.confidence),
          rationale: typeof x.rationale === 'string' ? x.rationale.slice(0, 400) : '' });
      }
    }
    let condition = (typeof r.condition === 'string' && CONDITIONS.includes(r.condition) ? r.condition : 'unclear') as PartReading['condition'];
    if (findings.length) condition = 'concern';
    else if (condition === 'concern') condition = 'unclear';
    out.parts.push({ key: cand.key, confidence, condition, note: typeof r.note === 'string' ? r.note.slice(0, 300) : '', findings });
    if (out.parts.length >= 8) break;
  }
  return out;
}

const model = () => env('ANTHROPIC_MODEL') ?? 'claude-sonnet-5';

async function claude(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const key = env('ANTHROPIC_API_KEY');
  if (!key) throw new HttpError(503, 'AI is not configured');
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: model(), ...body }),
  });
  if (!r.ok) {
    const t = await r.text();
    console.error('Anthropic API error', r.status, t.slice(0, 500));
    throw new HttpError(502, 'The AI service returned an error');
  }
  return (await r.json()) as Record<string, unknown>;
}

function toolInput(res: Record<string, unknown>): unknown {
  const content = (res.content as { type: string; input?: unknown }[] | undefined) ?? [];
  return content.find((c) => c.type === 'tool_use')?.input ?? null;
}

const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64');

/** Ask Claude which parts one photo shows and the visible condition of each. */
export async function analyzePhoto(image: { bytes: Uint8Array; type: string }, candidates: Candidate[], stageName: string): Promise<unknown> {
  const findingKeys = [...new Set(candidates.flatMap((c) => c.findings))];
  const byStage = new Map<string, Candidate[]>();
  for (const c of candidates) byStage.set(c.stage, [...(byStage.get(c.stage) ?? []), c]);
  const list = [...byStage.entries()].map(([stage, cs]) => `${stage}:\n` + cs.map((c) =>
    `- ${c.key}: ${c.label} (findings: ${c.findings.map((k) => findingLabel(k).toLowerCase()).join(', ')})`).join('\n')).join('\n\n');
  const res = await claude({
    max_tokens: 1500,
    system: 'You help automotive technicians inspect vehicles from photos. You only suggest; a technician confirms everything. '
      + 'Identify every listed part that is clearly visible in the photo (a photo often shows several) and judge the visible condition of each. '
      + 'Say "looks_ok" only when enough of the part is visible to see it is free of damage, leaks, corrosion and abnormal wear; '
      + 'say "concern" with at least one finding when you can see a problem; otherwise "unclear". '
      + 'Be conservative with positions (left = driver side in the US) and give low confidence when unsure. '
      + 'Never estimate measurements such as tread depth or pad thickness. Only report findings you can actually see.',
    tools: [{
      name: 'record_photo',
      description: 'Record each visible part and its condition.',
      input_schema: {
        type: 'object',
        properties: {
          parts: {
            type: 'array',
            maxItems: 8,
            items: {
              type: 'object',
              properties: {
                part: { type: 'string', enum: candidates.map((c) => c.key), description: 'Part key from the list' },
                confidence: { type: 'number', minimum: 0, maximum: 1, description: 'How sure you are this is that part at that position' },
                condition: { type: 'string', enum: CONDITIONS },
                note: { type: 'string', description: 'One short sentence on what is visible' },
                findings: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      key: { type: 'string', enum: findingKeys },
                      severity: { type: 'string', enum: SEVERITIES },
                      confidence: { type: 'number', minimum: 0, maximum: 1 },
                      rationale: { type: 'string', description: 'What is visible that supports this finding' },
                    },
                    required: ['key', 'severity', 'confidence', 'rationale'],
                  },
                },
              },
              required: ['part', 'confidence', 'condition', 'note', 'findings'],
            },
          },
        },
        required: ['parts'],
      },
    }],
    tool_choice: { type: 'tool', name: 'record_photo' },
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: image.type.startsWith('image/') ? image.type : 'image/jpeg', data: b64(image.bytes) } },
        { type: 'text', text: `Taken during the "${stageName}" stage of a vehicle inspection. Part keys look like "classId@position". `
          + `Parts on this vehicle, by stage (the photo's own stage first; it may also show parts from other stages):\n\n${list}\n\n`
          + 'List every visible part and its condition. Use an empty list if no listed part is identifiable.' },
      ],
    }],
  });
  return toolInput(res);
}

/**
 * Customer-friendly rewrite of a technician's note. Falls back to the rule-based rewrite if the model output
 * changes, adds or drops any number; returns null if neither passes.
 */
export async function rewriteNote(note: PointNote, context: string): Promise<string | null> {
  if (env('ANTHROPIC_API_KEY')) {
    try {
      const res = await claude({
        max_tokens: 400,
        system: 'You rewrite a mechanic\'s shorthand note for a vehicle owner. Plain, calm, short (1–3 sentences). '
          + 'Keep every number and unit exactly as given. Do not add findings, causes, repairs, prices, urgency or advice that is not in the note.',
        tools: [{ name: 'wording', description: 'The rewritten note', input_schema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } }],
        tool_choice: { type: 'tool', name: 'wording' },
        messages: [{ role: 'user', content: `Inspection point: ${context}\nTechnician note: ${note.techText}` }],
      });
      const out = (toolInput(res) as { text?: unknown } | null)?.text;
      if (typeof out === 'string' && out.trim() && wordingKeepsFacts(note.techText, out)) return out.trim();
    } catch (e) {
      if (!(e instanceof HttpError)) throw e;
    }
  }
  const s = suggestWording(note);
  return wordingKeepsFacts(note.techText, s) ? s : null;
}
