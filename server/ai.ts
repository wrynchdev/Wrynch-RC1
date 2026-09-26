// Claude vision for photo sorting, and customer wording. Every AI answer is validated against the ontology
// and the shop template before it is stored, and everything stored is a pending proposal (rules R4, R10).
import { cls, compLabel, findingLabel, parseKey, pointComponents } from '../src/domain/ontology';
import { suggestWording, wordingKeepsFacts } from '../src/domain/aiStub';
import type { CompKey, PointNote, Severity, Template, VehicleConfig } from '../src/domain/types';
import { env, HttpError } from './lib';

export interface Candidate { key: CompKey; pointId: string; label: string; findings: string[] }

/** Parts a photo from this stage could show, on this vehicle. */
export function candidatesFor(template: Template, sectionId: string, config: VehicleConfig): Candidate[] {
  const section = template.sections.find((s) => s.id === sectionId);
  if (!section) throw new HttpError(400, `Unknown stage ${sectionId}`);
  const out = new Map<CompKey, Candidate>();
  for (const p of section.points) {
    for (const c of pointComponents(p, config)) {
      if (!c.applies || out.has(c.key)) continue;
      const k = cls(parseKey(c.key).classId);
      if (k.aiPhoto === 'no') continue;
      out.set(c.key, { key: c.key, pointId: p.id, label: compLabel(c.key), findings: Object.keys(k.findings) });
    }
  }
  return [...out.values()];
}

export interface Proposal {
  mediaId: string;
  pointId: string | null;
  key: CompKey | null;
  confidence: number;
  finding: { key: string; severity: Severity; confidence: number; rationale: string } | null;
}

const SEVERITIES = ['minor', 'moderate', 'severe', 'critical'];
const clamp01 = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0);

/**
 * Turn raw model output into a safe proposal. Anything not on the candidate list, or a finding the ontology
 * doesn't allow for that part, is dropped. Low confidence leaves the photo for the technician to place.
 */
export function validateProposal(mediaId: string, raw: unknown, candidates: Candidate[], minConfidence = 0.55): Proposal {
  const empty: Proposal = { mediaId, pointId: null, key: null, confidence: 0, finding: null };
  if (!raw || typeof raw !== 'object') return empty;
  const r = raw as Record<string, unknown>;
  const cand = candidates.find((c) => c.key === r.part);
  const confidence = clamp01(r.confidence);
  if (!cand || confidence < minConfidence) return { ...empty, confidence };
  let finding: Proposal['finding'] = null;
  const f = r.finding as Record<string, unknown> | null | undefined;
  if (f && typeof f === 'object' && typeof f.key === 'string' && cand.findings.includes(f.key)
      && typeof f.severity === 'string' && SEVERITIES.includes(f.severity)) {
    finding = {
      key: f.key, severity: f.severity as Severity, confidence: clamp01(f.confidence),
      rationale: typeof f.rationale === 'string' ? f.rationale.slice(0, 400) : '',
    };
  }
  return { mediaId, pointId: cand.pointId, key: cand.key, confidence, finding };
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

/** Ask Claude which part one photo shows and whether it sees a problem. */
export async function classifyPhoto(image: { bytes: Uint8Array; type: string }, candidates: Candidate[], stageName: string): Promise<unknown> {
  const findingKeys = [...new Set(candidates.flatMap((c) => c.findings))];
  const list = candidates.map((c) => `- ${c.key}: ${c.label} (allowed findings: ${c.findings.map((k) => findingLabel(k).toLowerCase()).join(', ')})`).join('\n');
  const res = await claude({
    max_tokens: 600,
    system: 'You help automotive technicians sort inspection photos. You only suggest; a technician confirms everything. '
      + 'Be conservative: if the part or position is not clearly identifiable, give low confidence. Never estimate measurements. '
      + 'Only report a finding you can actually see in the photo.',
    tools: [{
      name: 'record_photo',
      description: 'Record which part the photo shows and any visible problem.',
      input_schema: {
        type: 'object',
        properties: {
          part: { type: ['string', 'null'], enum: [...candidates.map((c) => c.key), null], description: 'Part key from the list, or null if none fits' },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
          finding: {
            type: ['object', 'null'],
            properties: {
              key: { type: 'string', enum: findingKeys },
              severity: { type: 'string', enum: SEVERITIES },
              confidence: { type: 'number', minimum: 0, maximum: 1 },
              rationale: { type: 'string', description: 'One sentence: what is visible that supports this finding' },
            },
            required: ['key', 'severity', 'confidence', 'rationale'],
          },
        },
        required: ['part', 'confidence', 'finding'],
      },
    }],
    tool_choice: { type: 'tool', name: 'record_photo' },
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: image.type.startsWith('image/') ? image.type : 'image/jpeg', data: b64(image.bytes) } },
        { type: 'text', text: `This photo was taken during the "${stageName}" stage of a vehicle inspection. Part keys look like "classId@position".\n\nPossible parts:\n${list}\n\nWhich part does the photo show, and is any allowed finding clearly visible?` },
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
