// Claude vision for photo sorting, and customer wording. Every AI answer is validated against the ontology
// and the shop template before it is stored, and everything stored is a pending proposal (rules R4, R10).
import { cls, compLabel, findingLabel, parseKey, pointComponents } from '../src/domain/ontology';
import { suggestWording, wordingKeepsFacts, type PartReading, type PhotoAnalysis } from '../src/domain/aiStub';
import type { CompKey, PointNote, Severity, Template, VehicleConfig } from '../src/domain/types';
import { SIDE_UNSURE_CONFIDENCE } from '../src/domain/types';
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
 * When the model knows the part but not which corner of the car it is on, the photo is linked as a hint with
 * confidence SIDE_UNSURE_CONFIDENCE and no condition claims: the technician picks the side.
 */
export function validateAnalysis(mediaId: string, raw: unknown, candidates: Candidate[], minConfidence = 0.6): PhotoAnalysis {
  const out: PhotoAnalysis = { mediaId, parts: [] };
  const list = (raw as { parts?: unknown } | null)?.parts;
  if (!Array.isArray(list)) return out;
  for (const item of list.slice(0, 12)) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    const cand = candidates.find((c) => c.key === r.part);
    const confidence = clamp01(r.confidence);
    if (!cand || confidence < minConfidence || out.parts.some((p) => p.key === cand.key)) continue;
    const classId = parseKey(cand.key).classId;
    const otherSides = candidates.some((c) => c.key !== cand.key && parseKey(c.key).classId === classId);
    if (r.position_certain === false && otherSides) {
      if (out.parts.some((p) => parseKey(p.key).classId === classId)) continue;
      out.parts.push({ key: cand.key, confidence: SIDE_UNSURE_CONFIDENCE, condition: 'unclear', note: 'Side not certain from this photo.', findings: [] });
      if (out.parts.length >= 8) break;
      continue;
    }
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

/** A plain-language reason for an Anthropic API error (never includes the key). */
export function explainAiError(status: number, body: string): string {
  let type = '', message = '';
  try { const e = JSON.parse(body).error ?? {}; type = String(e.type ?? ''); message = String(e.message ?? ''); } catch { /* not JSON */ }
  if (status === 401 || type === 'authentication_error') return 'The Anthropic API key isn’t valid. Check ANTHROPIC_API_KEY in Vercel.';
  if (/workspace/i.test(message)) return 'This Anthropic key isn’t tied to a workspace. Set ANTHROPIC_WORKSPACE_ID in Vercel, or create the key inside a workspace.';
  if (/credit balance|billing/i.test(message)) return 'The Anthropic account is out of credit. Add credit at console.anthropic.com.';
  if (status === 403 || type === 'permission_error') return 'The Anthropic API key doesn’t have access to this model.';
  if (status === 404 || type === 'not_found_error') return `The AI model “${model()}” isn’t available. Check ANTHROPIC_MODEL in Vercel.`;
  if (status === 429 || type === 'rate_limit_error') return 'The AI is rate-limited right now. Wait a minute and try again.';
  if (status === 529 || status >= 500 || type === 'overloaded_error' || type === 'api_error') return 'The AI service is busy. Try again in a minute.';
  if (/image/i.test(message)) return `The AI couldn’t open this photo (${message.slice(0, 120)}).`;
  return `The AI service returned an error${message ? `: ${message.slice(0, 160)}` : ` (${status})`}.`;
}

const AI_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
const AI_IMAGE_MAX = 5 * 1024 * 1024;

export const model = () => env('ANTHROPIC_MODEL') ?? 'claude-sonnet-5';
/** Real AI when a key is set; the rule-based stand-in only when explicitly asked for (tests, local demos). */
export const aiMode = (): 'claude' | 'stub' | 'off' => (env('ANTHROPIC_API_KEY') ? 'claude' : env('AI_STUB') === '1' ? 'stub' : 'off');

// Some models don't accept a forced tool choice. After the first refusal we ask with tool_choice "auto" and an
// instruction to call the tool instead (per server instance).
let forcedToolUnsupported = false;

function withAutoToolChoice(body: Record<string, unknown>): Record<string, unknown> {
  const choice = body.tool_choice as { type?: string; name?: string } | undefined;
  if (!choice || (choice.type !== 'tool' && choice.type !== 'any')) return body;
  const name = choice.name ?? 'the tool';
  return { ...body, tool_choice: { type: 'auto' }, system: `${body.system ?? ''}\n\nAlways answer by calling the ${name} tool exactly once. Do not answer in plain text.` };
}

async function send(key: string, body: Record<string, unknown>): Promise<Response> {
  try {
    return await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json',
        // Keys that aren't scoped to a workspace must name one.
        ...(env('ANTHROPIC_WORKSPACE_ID') ? { 'anthropic-workspace-id': env('ANTHROPIC_WORKSPACE_ID')! } : {}),
      },
      body: JSON.stringify({ model: model(), ...body }),
      // Stay inside the 60-second function limit so the app gets a clear answer.
      signal: AbortSignal.timeout(50_000),
    });
  } catch (e) {
    const timedOut = e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError');
    throw new HttpError(504, timedOut ? 'The AI took too long on this photo. Try again.' : 'Couldn’t reach the AI service. Try again.');
  }
}

async function claude(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const key = env('ANTHROPIC_API_KEY');
  if (!key) throw new HttpError(503, 'AI is not configured');
  let r = await send(key, forcedToolUnsupported ? withAutoToolChoice(body) : body);
  if (!r.ok) {
    const t = await r.text();
    if (r.status === 400 && /tool_choice/i.test(t) && !forcedToolUnsupported) {
      forcedToolUnsupported = true;
      r = await send(key, withAutoToolChoice(body));
      if (r.ok) return (await r.json()) as Record<string, unknown>;
      const t2 = await r.text();
      console.error('Anthropic API error', r.status, t2.slice(0, 500));
      throw new HttpError(502, explainAiError(r.status, t2));
    }
    console.error('Anthropic API error', r.status, t.slice(0, 500));
    throw new HttpError(502, explainAiError(r.status, t));
  }
  return (await r.json()) as Record<string, unknown>;
}

/** The tool call's input; if the model answered in text instead, the first JSON object in that text. */
function toolInput(res: Record<string, unknown>): unknown {
  const content = (res.content as { type: string; input?: unknown; text?: string }[] | undefined) ?? [];
  const call = content.find((c) => c.type === 'tool_use');
  if (call) return call.input ?? null;
  const text = content.filter((c) => c.type === 'text').map((c) => c.text ?? '').join('\n');
  const a = text.indexOf('{'), b = text.lastIndexOf('}');
  if (a >= 0 && b > a) { try { return JSON.parse(text.slice(a, b + 1)); } catch { /* not JSON */ } }
  return null;
}

/** Test hook: forget what we learned about forced tool choice. */
export function resetAiState() { forcedToolUnsupported = false; }

const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64');

/** Ask Claude which parts one photo shows and the visible condition of each. */
export async function analyzePhoto(image: { bytes: Uint8Array; type: string }, candidates: Candidate[], stageName: string, vehicleText = ''): Promise<unknown> {
  const type = image.type.split(';')[0].trim().toLowerCase();
  if (!AI_IMAGE_TYPES.includes(type)) throw new HttpError(415, `This photo is ${type || 'an unknown format'}; the AI reads JPEG or PNG. Retake it or export it as JPEG.`);
  if (image.bytes.length * 4 / 3 > AI_IMAGE_MAX) throw new HttpError(413, 'This photo is too large for the AI. Retake it at a lower resolution.');
  const findingKeys = [...new Set(candidates.flatMap((c) => c.findings))];
  const byStage = new Map<string, Candidate[]>();
  for (const c of candidates) byStage.set(c.stage, [...(byStage.get(c.stage) ?? []), c]);
  const list = [...byStage.entries()].map(([stage, cs]) => `${stage}:\n` + cs.map((c) =>
    `- ${c.key}: ${c.label} (findings: ${c.findings.map((k) => findingLabel(k).toLowerCase()).join(', ')})`).join('\n')).join('\n\n');
  const res = await claude({
    max_tokens: 4000,
    system: [
      'You help automotive technicians inspect vehicles from photos. You only suggest; a technician confirms everything.',
      'Work in this order: first describe what the photo shows and where the camera is (engine bay, under the car looking up, a wheel well, the interior, etc.). Then list the parts from the list that are clearly visible, and judge the condition of each.',
      'Only list a part if you can actually see it well enough to recognise it. Do not list parts that are merely likely to be nearby or that are hidden behind other parts. Fewer, correct parts are better than many guesses.',
      'Positions: left = driver side, right = passenger side (US vehicles). Decide the corner only from evidence in the photo: steering rack or tie rods (front), axle or differential (rear), exhaust routing, fuel tank or filler, a visible fender, bumper or door, or the engine layout. A close-up of one wheel, brake or suspension part usually does not show which corner it is: then set position_certain to false and pick your best guess.',
      'Condition: "looks_ok" only when enough of the part is visible to see it is free of damage, leaks, corrosion and abnormal wear. "concern" with at least one finding when you can see a problem. Otherwise "unclear". Surface rust and road grime on underbody parts are normal.',
      'Never estimate measurements such as tread depth, pad thickness or rotor thickness. Only report findings you can actually see.',
      'Confidence is how sure you are that it is this part; use 0.9+ only when it is unmistakable.',
    ].join(' '),
    tools: [{
      name: 'record_photo',
      description: 'Record what the photo shows, each visible part and its condition.',
      input_schema: {
        type: 'object',
        properties: {
          view: { type: 'string', description: 'One or two sentences: what the photo shows, where the camera is, and any clues about front/rear and left/right.' },
          parts: {
            type: 'array',
            maxItems: 8,
            items: {
              type: 'object',
              properties: {
                part: { type: 'string', enum: candidates.map((c) => c.key), description: 'Part key from the list' },
                confidence: { type: 'number', minimum: 0, maximum: 1, description: 'How sure you are this is that part' },
                position_certain: { type: 'boolean', description: 'True only if the photo itself shows which corner/side this part is on' },
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
              required: ['part', 'confidence', 'position_certain', 'condition', 'note', 'findings'],
            },
          },
        },
        required: ['view', 'parts'],
      },
    }],
    tool_choice: { type: 'tool', name: 'record_photo' },
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: type, data: b64(image.bytes) } },
        { type: 'text', text: `${vehicleText ? `Vehicle: ${vehicleText}. ` : ''}Taken during the "${stageName}" stage of a vehicle inspection. Part keys look like "classId@position". `
          + `Parts on this vehicle, by stage (the photo's own stage first; it may also show parts from other stages):\n\n${list}\n\n`
          + 'Describe the view, then list only the parts you can clearly see, with their condition. Use an empty list if no listed part is identifiable.' },
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
