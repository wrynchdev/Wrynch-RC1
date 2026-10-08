// AI vision for photo sorting (Anthropic or OpenAI), and customer wording. Every AI answer is validated against the ontology
// and the shop template before it is stored, and everything stored is a pending proposal (rules R4, R10).
import { checkOff, cls, compLabel, DEFAULT_TEMPLATE, findingLabel, ONTOLOGY, parseKey, pointComponents } from '../src/domain/ontology';
import { suggestWording, wordingKeepsFacts, type PartReading, type PhotoAnalysis } from '../src/domain/aiStub';
import { filterByCorner, type Corner } from '../src/domain/corner';
import { draftKeepsFacts, factsText, type NoteStyle, type PointFacts } from '../src/domain/noteDraft';
import type { CompKey, PointNote, Severity, Template, VehicleConfig } from '../src/domain/types';
import { SIDE_UNSURE_CONFIDENCE } from '../src/domain/types';
import { currentAi, DEFAULT_ANTHROPIC_MODEL, type AiAccount, type AiProvider } from './aiContext';
import { env, HttpError } from './lib';

export interface Candidate { key: CompKey; stage: string; point: string; label: string; findings: string[]; lookFor: string[] }

/**
 * Parts a photo could show: the photo-capable parts of the inspection points in the stage the photo was taken in.
 * A part shared by several points in that stage is listed once, under the first point.
 */
export function candidatesFor(template: Template, sectionId: string, config: VehicleConfig, pointId?: string | null, corner?: Corner | null): Candidate[] {
  const section = template.sections.find((s) => s.id === sectionId);
  if (!section) throw new HttpError(400, `Unknown stage ${sectionId}`);
  const out = new Map<CompKey, Candidate>();
  const points = pointId ? section.points.filter((p) => p.id === pointId) : section.points;
  for (const p of points.length ? points : section.points) {
    for (const c of pointComponents(p, config)) {
      if (!c.applies || out.has(c.key)) continue;
      const k = cls(parseKey(c.key).classId);
      if (k.aiPhoto === 'no') continue;
      out.set(c.key, { key: c.key, stage: section.name, point: p.name, label: compLabel(c.key), findings: Object.keys(k.findings), lookFor: lookFor(k.checks, template.checksOff ?? []) });
    }
  }
  return filterByCorner([...out.values()], (c) => c.key, corner);
}

/** What to look for on a part: its visual checks that are on in this template. */
function lookFor(checks: readonly string[], off: readonly string[]): string[] {
  return checks.map((k) => ONTOLOGY.checks[k]).filter((c) => c && c.method === 'visual' && checkOff(c.key, off) === null).map((c) => c.how);
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

/** A plain-language reason for an AI provider error (never includes the key). */
export function explainAiError(status: number, body: string, provider: AiProvider = 'anthropic', source: 'shop' | 'platform' = 'platform'): string {
  let type = '', message = '';
  try { const e = JSON.parse(body).error ?? {}; type = String(e.type ?? e.code ?? ''); message = String(e.message ?? ''); } catch { /* not JSON */ }
  const who = provider === 'openai' ? 'OpenAI' : 'Anthropic';
  const fixKey = source === 'shop' ? 'Check the AI key in Settings.' : provider === 'anthropic' ? 'Check ANTHROPIC_API_KEY in Vercel.' : 'Check OPENAI_API_KEY in Vercel.';
  if (status === 401 || type === 'authentication_error' || type === 'invalid_api_key') return `The ${who} API key isn’t valid. ${fixKey}`.trim();
  if (/workspace/i.test(message)) return 'This Anthropic key isn’t tied to a workspace. Set ANTHROPIC_WORKSPACE_ID in Vercel, or create the key inside a workspace.';
  if (/credit balance|billing|insufficient_quota|quota/i.test(`${message} ${type}`)) return `The ${who} account is out of credit or over its quota.${source === 'shop' ? ' Add credit with your AI provider.' : ''}`;
  if (status === 403 || type === 'permission_error') return `The ${who} API key doesn’t have access to this model.`;
  if (status === 404 || type === 'not_found_error' || type === 'model_not_found') return `The AI model “${model()}” isn’t available. ${source === 'shop' ? 'Choose another model in Settings.' : `Check ${provider === 'openai' ? 'OPENAI_MODEL' : 'ANTHROPIC_MODEL'} in Vercel.`}`;
  if (status === 429 || type === 'rate_limit_error') return 'The AI is rate-limited right now. Wait a minute and try again.';
  if (status === 529 || status >= 500 || type === 'overloaded_error' || type === 'api_error') return 'The AI service is busy. Try again in a minute.';
  if (/image/i.test(message)) return `The AI couldn’t open this photo (${message.slice(0, 120)}).`;
  return `The AI service returned an error${message ? `: ${message.slice(0, 160)}` : ` (${status})`}.`;
}

const AI_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
const AI_IMAGE_MAX = 5 * 1024 * 1024;

export const model = () => currentAi()?.model ?? env('ANTHROPIC_MODEL') ?? DEFAULT_ANTHROPIC_MODEL;
/** Real AI when a key is set (the shop's own, or Wrynch's); the rule-based stand-in only when explicitly asked for (tests, local demos). */
export const aiMode = (): 'live' | 'stub' | 'off' => (currentAi() ? 'live' : env('AI_STUB') === '1' ? 'stub' : 'off');

// Some models don't accept a forced tool choice. After the first refusal we ask with tool_choice "auto" and an
// instruction to call the tool instead (per server instance).
const forcedToolUnsupported = new Set<string>(); // models that refused a forced tool choice

function withAutoToolChoice(body: Record<string, unknown>): Record<string, unknown> {
  const choice = body.tool_choice as { type?: string; name?: string } | undefined;
  if (!choice || (choice.type !== 'tool' && choice.type !== 'any')) return body;
  const name = choice.name ?? 'the tool';
  return { ...body, tool_choice: { type: 'auto' }, system: `${body.system ?? ''}\n\nAlways answer by calling the ${name} tool exactly once. Do not answer in plain text.` };
}

async function send(acct: AiAccount, body: Record<string, unknown>): Promise<Response> {
  try {
    return await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': acct.key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json',
        // Wrynch's own key may need its workspace named; a shop's key is used as it is.
        ...(acct.source === 'platform' && env('ANTHROPIC_WORKSPACE_ID') ? { 'anthropic-workspace-id': env('ANTHROPIC_WORKSPACE_ID')! } : {}),
      },
      body: JSON.stringify({ model: acct.model, ...body }),
      // Stay inside the 60-second function limit so the app gets a clear answer.
      signal: AbortSignal.timeout(50_000),
    });
  } catch (e) {
    const timedOut = e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError');
    throw new HttpError(504, timedOut ? 'The AI took too long on this photo. Try again.' : 'Couldn’t reach the AI service. Try again.');
  }
}

async function askAi(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const acct = currentAi();
  if (!acct) throw new HttpError(503, 'AI is not configured');
  if (acct.provider === 'openai') return openaiMessages(acct, body);
  const forced = forcedToolUnsupported.has(acct.model);
  let r = await send(acct, forced ? withAutoToolChoice(body) : body);
  if (!r.ok) {
    const t = await r.text();
    if (r.status === 400 && /tool_choice/i.test(t) && !forced) {
      forcedToolUnsupported.add(acct.model);
      r = await send(acct, withAutoToolChoice(body));
      if (r.ok) return (await r.json()) as Record<string, unknown>;
      const t2 = await r.text();
      console.error('Anthropic API error', r.status, t2.slice(0, 500));
      throw new HttpError(502, explainAiError(r.status, t2, 'anthropic', acct.source));
    }
    console.error('Anthropic API error', r.status, t.slice(0, 500));
    throw new HttpError(502, explainAiError(r.status, t, 'anthropic', acct.source));
  }
  return (await r.json()) as Record<string, unknown>;
}

type Block = { type: string; text?: string; source?: { type: string; media_type?: string; data?: string } };
/**
 * The same request through OpenAI's Chat Completions API, for an OpenAI key (a shop's own, or Wrynch's). Our requests
 * (system prompt, text and images, one forced tool) are translated, and the answer is returned in the shape the rest
 * of this file reads (a tool_use block, or text).
 */
async function openaiMessages(acct: AiAccount, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const part = (b: Block) => {
    if (b.type === 'text') return { type: 'text', text: b.text ?? '' };
    if (b.type === 'image' && b.source?.type === 'base64') return { type: 'image_url', image_url: { url: `data:${b.source.media_type};base64,${b.source.data}` } };
    throw new HttpError(422, 'This AI provider can’t read this kind of file. Use a photo instead.');
  };
  const messages: Record<string, unknown>[] = [];
  if (body.system) messages.push({ role: 'system', content: String(body.system) });
  for (const m of (body.messages as { role: string; content: string | Block[] }[]) ?? []) {
    messages.push({ role: m.role, content: typeof m.content === 'string' ? m.content : m.content.map(part) });
  }
  const tools = ((body.tools as { name: string; description?: string; input_schema: unknown }[]) ?? [])
    .map((t) => ({ type: 'function', function: { name: t.name, description: t.description ?? '', parameters: t.input_schema } }));
  const choice = body.tool_choice as { type?: string; name?: string } | undefined;
  // OpenAI's reasoning models count their thinking against this limit, so it's set well above the answer size.
  const req: Record<string, unknown> = { model: acct.model, messages, max_completion_tokens: Math.max(4096, 3 * Number(body.max_tokens ?? 1024)) };
  if (tools.length) {
    req.tools = tools;
    req.tool_choice = choice?.type === 'tool' && choice.name ? { type: 'function', function: { name: choice.name } } : 'auto';
  }
  let r: Response;
  try {
    r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST', headers: { authorization: `Bearer ${acct.key}`, 'content-type': 'application/json' },
      body: JSON.stringify(req), signal: AbortSignal.timeout(50_000),
    });
  } catch (e) {
    const timedOut = e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError');
    throw new HttpError(504, timedOut ? 'The AI took too long on this photo. Try again.' : 'Couldn’t reach the AI service. Try again.');
  }
  if (!r.ok) {
    const t = await r.text();
    console.error('OpenAI API error', r.status, t.slice(0, 500));
    throw new HttpError(502, explainAiError(r.status, t, 'openai', acct.source));
  }
  const out = (await r.json()) as { choices?: { message?: { content?: string | null; tool_calls?: { function?: { arguments?: string } }[] } }[] };
  const msg = out.choices?.[0]?.message;
  const args = msg?.tool_calls?.[0]?.function?.arguments;
  if (args) { try { return { content: [{ type: 'tool_use', input: JSON.parse(args) }] }; } catch { /* fall through to text */ } }
  return { content: [{ type: 'text', text: msg?.content ?? args ?? '' }] };
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
export function resetAiState() { forcedToolUnsupported.clear(); }

const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64');

/** Ask the AI which parts one photo shows and the visible condition of each. */
export async function analyzePhoto(image: { bytes: Uint8Array; type: string }, candidates: Candidate[], stageName: string, vehicleText = ''): Promise<unknown> {
  const type = image.type.split(';')[0].trim().toLowerCase();
  if (!AI_IMAGE_TYPES.includes(type)) throw new HttpError(415, `This photo is ${type || 'an unknown format'}; the AI reads JPEG or PNG. Retake it or export it as JPEG.`);
  if (image.bytes.length * 4 / 3 > AI_IMAGE_MAX) throw new HttpError(413, 'This photo is too large for the AI. Retake it at a lower resolution.');
  const findingKeys = [...new Set(candidates.flatMap((c) => c.findings))];
  const byPoint = new Map<string, Candidate[]>();
  for (const c of candidates) byPoint.set(c.point, [...(byPoint.get(c.point) ?? []), c]);
  const list = [...byPoint.entries()].map(([point, cs]) => `${point}:\n` + cs.map((c) =>
    `- ${c.key}: ${c.label}${c.lookFor.length ? `; look for: ${c.lookFor.join('; ')}` : ''} (findings: ${c.findings.map((k) => findingLabel(k).toLowerCase()).join(', ')})`).join('\n')).join('\n\n');
  const res = await askAi({
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
          + `Only these parts count: the inspection points of this stage and the parts behind each (parts from other stages are not on this list and must not be reported):\n\n${list}\n\n`
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
export async function rewriteNote(note: PointNote, context: string, style: NoteStyle = 'customer'): Promise<string | null> {
  if (currentAi()) {
    try {
      const res = await askAi({
        max_tokens: 400,
        system: (style === 'customer'
          ? 'You rewrite a mechanic\'s shorthand note for a vehicle owner who is not a mechanic. Plain, calm, everyday words; explain jargon briefly; short (1–3 sentences). '
          : 'You rewrite a mechanic\'s shorthand note into a clean, professional technical note for the service advisor and a knowledgeable customer. Standard automotive terminology, no slang or shorthand, short (1–3 sentences). ')
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

// ------------------------------------------------------------------ template preview (marketing site)

export interface DraftPoint { stage: string; name: string; detail?: string }
export interface MappedPart { classId: number; label: string; positions: (string | null)[]; ifEquipped: boolean }
export interface MappedPoint { stage: string; name: string; matched: string[]; parts: MappedPart[]; count: number; note: string }

const TEMPLATE_TYPES = ['application/pdf', ...AI_IMAGE_TYPES];
const clip = (v: unknown, n: number) => (typeof v === 'string' ? v.trim().slice(0, n) : '');

/** Read a shop's inspection sheet (PDF or photo) into stages and points. Nothing is stored. */
export async function readTemplate(file: { bytes: Uint8Array; type: string }): Promise<{ name: string; points: DraftPoint[] }> {
  const type = file.type.split(';')[0].trim().toLowerCase();
  if (!TEMPLATE_TYPES.includes(type)) throw new HttpError(415, 'Upload a PDF or a photo (JPEG or PNG) of your inspection sheet.');
  const block = type === 'application/pdf'
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64(file.bytes) } }
    : { type: 'image', source: { type: 'base64', media_type: type, data: b64(file.bytes) } };
  const res = await askAi({
    max_tokens: 4000,
    system: 'You read vehicle multi-point inspection (MPI) sheets used by auto repair shops. Transcribe the inspection items exactly as the shop wrote them, grouped under the section headings on the sheet. '
      + 'Include only items a technician inspects or checks (skip customer details, signatures, legends, pricing and marketing text). If there are no section headings, use one section named "Inspection". '
      + 'If the document is not an inspection sheet, return an empty list.',
    tools: [{
      name: 'record_template',
      description: 'The inspection sheet as sections and items.',
      input_schema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'The title of the sheet, if any' },
          points: {
            type: 'array', maxItems: 80,
            items: {
              type: 'object',
              properties: {
                stage: { type: 'string', description: 'Section heading the item is under' },
                name: { type: 'string', description: 'The item as written on the sheet' },
                detail: { type: 'string', description: 'Any sub-items or measurements listed with it (e.g. "LF RF LR RR", "32nds")' },
              },
              required: ['stage', 'name'],
            },
          },
        },
        required: ['points'],
      },
    }],
    tool_choice: { type: 'tool', name: 'record_template' },
    messages: [{ role: 'user', content: [block, { type: 'text', text: 'List every inspection item on this sheet under its section.' }] }],
  });
  const raw = toolInput(res) as { name?: unknown; points?: unknown } | null;
  const points = (Array.isArray(raw?.points) ? raw!.points : []).slice(0, 80).map((p) => {
    const x = p as Record<string, unknown>;
    return { stage: clip(x.stage, 60) || 'Inspection', name: clip(x.name, 120), detail: clip(x.detail, 200) || undefined };
  }).filter((p) => p.name);
  return { name: clip(raw?.name, 120), points };
}

/** The standard template's points, as the reference for mapping. */
function standardPointsText(): string {
  return DEFAULT_TEMPLATE.sections.map((s) => `${s.name}:\n` + s.points.map((p) =>
    `- ${p.id} "${p.name}": ` + [...new Set(p.components.map((c) => cls(c.classId).label))].join(', ')).join('\n')).join('\n\n');
}
function catalogText(): string {
  return Object.values(ONTOLOGY.classes).map((c) => `${c.id}: ${c.label}${c.positions.length ? ` [${c.positions.join(', ')}]` : ''}`).join('\n');
}

const POSITION_ORDER = ['left_front', 'right_front', 'left_rear', 'right_rear', 'front', 'rear', 'left', 'right', 'center', 'left_mid', 'right_mid', 'roof', 'bed', 'cargo_area', 'underbody'];

/** Turn the model's choices into parts: standard points bring their parts (with positions and "if equipped"), extras are validated. */
export function buildMappedPoint(p: DraftPoint, raw: Record<string, unknown> | undefined): MappedPoint {
  const byId = new Map(DEFAULT_TEMPLATE.sections.flatMap((s) => s.points).map((x) => [x.id, x]));
  const comps: { classId: number; position: string | null; when: string }[] = [];
  const matched: string[] = [];
  for (const id of Array.isArray(raw?.standard) ? raw!.standard : []) {
    const sp = typeof id === 'string' ? byId.get(id) : undefined;
    if (!sp || matched.includes(sp.name)) continue;
    matched.push(sp.name);
    comps.push(...sp.components.map((c) => ({ classId: c.classId, position: c.position, when: c.when })));
  }
  for (const e of Array.isArray(raw?.extra) ? raw!.extra : []) {
    const x = e as Record<string, unknown>;
    const c = ONTOLOGY.classes[Number(x.classId)];
    if (!c) continue;
    const asked = (Array.isArray(x.positions) ? x.positions : []).filter((q): q is string => typeof q === 'string' && c.positions.includes(q));
    const positions: (string | null)[] = !c.positions.length ? [null] : asked.length ? asked : c.positionRule === 'required' ? c.positions : [null];
    for (const position of positions) comps.push({ classId: c.id, position, when: 'always' });
  }
  const groups = new Map<number, MappedPart>();
  const seen = new Set<string>();
  for (const c of comps) {
    const k = `${c.classId}@${c.position ?? ''}`;
    const g = groups.get(c.classId) ?? { classId: c.classId, label: cls(c.classId).label, positions: [], ifEquipped: true };
    if (!seen.has(k)) { seen.add(k); g.positions.push(c.position); }
    g.ifEquipped &&= c.when !== 'always';
    groups.set(c.classId, g);
  }
  const parts = [...groups.values()].map((g) => ({ ...g, positions: g.positions.sort((a, b) => POSITION_ORDER.indexOf(a ?? '') - POSITION_ORDER.indexOf(b ?? '')) }));
  return { stage: p.stage, name: p.name, matched, parts, count: seen.size, note: clip(raw?.note, 200) };
}

/** Map a batch of a shop's inspection items to the parts behind them. */
export async function mapTemplatePoints(points: DraftPoint[]): Promise<MappedPoint[]> {
  const res = await askAi({
    max_tokens: 6000,
    system: 'You map a repair shop\'s inspection items to the parts a technician actually checks for each item. '
      + 'Prefer the standard inspection points (by id): pick every standard point the item covers. Add extra parts from the catalog only for parts the item clearly covers that its standard points do not. '
      + 'For extra parts give positions from the part\'s allowed list when the item names specific corners or sides (e.g. "LF tire" = left_front); leave positions empty when it covers all of them. '
      + 'If an item is not about inspecting parts (e.g. "customer concern", "road test notes"), return no standard points and no extras and say so in the note.',
    tools: [{
      name: 'record_mapping',
      description: 'The parts behind each inspection item, in the same order as given.',
      input_schema: {
        type: 'object',
        properties: {
          items: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                index: { type: 'integer', description: 'Index of the item in the list given' },
                standard: { type: 'array', items: { type: 'string' }, description: 'Ids of standard points this item covers' },
                extra: { type: 'array', items: { type: 'object', properties: { classId: { type: 'integer' }, positions: { type: 'array', items: { type: 'string' } } }, required: ['classId'] } },
                note: { type: 'string', description: 'Optional short note, e.g. why nothing maps' },
              },
              required: ['index', 'standard', 'extra'],
            },
          },
        },
        required: ['items'],
      },
    }],
    tool_choice: { type: 'tool', name: 'record_mapping' },
    messages: [{
      role: 'user',
      content: `Standard inspection points (id "name": parts):\n\n${standardPointsText()}\n\nPart catalog (id: name [allowed positions]):\n${catalogText()}\n\n`
        + `Shop's inspection items:\n${points.map((p, i) => `${i}. [${p.stage}] ${p.name}${p.detail ? ` (${p.detail})` : ''}`).join('\n')}`,
    }],
  });
  const raw = toolInput(res) as { items?: unknown } | null;
  const items = Array.isArray(raw?.items) ? (raw!.items as Record<string, unknown>[]) : [];
  return points.map((p, i) => buildMappedPoint(p, items.find((x) => Number(x?.index) === i)));
}

/** Test and local-demo stand-in: match items to standard points by shared words. */
export function mapTemplatePointsStub(points: DraftPoint[]): MappedPoint[] {
  const std = DEFAULT_TEMPLATE.sections.flatMap((s) => s.points);
  const words = (t: string) => new Set(t.toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 2));
  return points.map((p) => {
    const w = words(p.name);
    const best = std.map((s) => ({ s, n: [...words(s.name)].filter((x) => w.has(x)).length })).sort((a, b) => b.n - a.n)[0];
    return buildMappedPoint(p, best && best.n > 0 ? { standard: [best.s.id], extra: [] } : { standard: [], extra: [], note: 'No match in the stand-in.' });
  });
}

// ------------------------------------------------------------------ technician note drafts

/**
 * Draft a technician note for one inspection point from its confirmed facts and confirmed photos.
 * Returns null if the model's draft uses a number that isn't in the facts (the caller falls back to the rules draft).
 */
export async function writePointNote(facts: PointFacts, photos: { bytes: Uint8Array; type: string }[], style: NoteStyle = 'technical'): Promise<string | null> {
  const images = photos.filter((p) => AI_IMAGE_TYPES.includes(p.type.split(';')[0].trim().toLowerCase()) && p.bytes.length * 4 / 3 <= AI_IMAGE_MAX).slice(0, 3)
    .map((p) => ({ type: 'image', source: { type: 'base64', media_type: p.type.split(';')[0].trim().toLowerCase(), data: b64(p.bytes) } }));
  const res = await askAi({
    max_tokens: 800,
    system: 'You write the note an automotive technician leaves on one inspection point. The customer and service advisor read it. '
      + (style === 'customer'
        ? 'Write for a vehicle owner who is not a mechanic: 1–3 short sentences in plain, calm, everyday words (say "needs attention now" or "worth keeping an eye on" rather than rating codes).'
        : 'Write in concise, professional shop terminology for the service advisor: 1–3 short sentences.')
      + ' Lead with anything rated immediate attention or monitor, then briefly say the rest checked OK. '
      + 'Use ONLY the confirmed facts given: do not add parts, findings, causes, repairs, prices or urgency that are not in them, and never change a rating. '
      + 'Use every measurement exactly as written (same numbers and units) and no other numbers. '
      + 'The photos are the technician\'s confirmed photos of these parts: you may use them only to describe what the facts already say (for example where the wear is), never to add a new problem.',
    tools: [{ name: 'note', description: 'The drafted note', input_schema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } }],
    tool_choice: { type: 'tool', name: 'note' },
    messages: [{ role: 'user', content: [...images, { type: 'text', text: `Inspection point: ${facts.point}\nConfirmed facts:\n${factsText(facts)}\n\nWrite the technician's note.` }] }],
  });
  const text = (toolInput(res) as { text?: unknown } | null)?.text;
  if (typeof text !== 'string' || !text.trim()) return null;
  const out = text.trim().slice(0, 600);
  return draftKeepsFacts(facts, out) ? out : null;
}

// ------------------------------------------------------------------ training-data pre-draw

/**
 * First-guess boxes around the parts a technician confirmed on a photo, for Wrynch staff to correct before they're
 * used as training data. Only listed parts are kept, and every box is clamped to the photo. Nothing is stored here.
 */
export async function locateParts(image: { bytes: Uint8Array; type: string }, parts: { key: string; label: string }[]): Promise<{ key: string; x: number; y: number; w: number; h: number }[]> {
  const type = image.type.split(';')[0].trim().toLowerCase();
  if (!AI_IMAGE_TYPES.includes(type)) throw new HttpError(422, `This photo is ${type}; the AI reads JPEG or PNG.`);
  const res = await askAi({
    max_tokens: 1200,
    system: 'You locate vehicle parts in a technician\'s inspection photo. For each listed part that is clearly visible, give one tight bounding box '
      + 'as fractions of the image: x and y of the top-left corner, w and h of the size, each between 0 and 1. Leave out parts you cannot see. '
      + 'Use only the part ids given.',
    tools: [{ name: 'boxes', description: 'Boxes around visible parts', input_schema: { type: 'object', properties: { boxes: { type: 'array', items: {
      type: 'object', properties: { part: { type: 'string' }, x: { type: 'number' }, y: { type: 'number' }, w: { type: 'number' }, h: { type: 'number' } },
      required: ['part', 'x', 'y', 'w', 'h'] } } }, required: ['boxes'] } }],
    tool_choice: { type: 'tool', name: 'boxes' },
    messages: [{ role: 'user', content: [
      { type: 'image', source: { type: 'base64', media_type: type, data: b64(image.bytes) } },
      { type: 'text', text: `Parts the technician confirmed in this photo:\n${parts.map((p) => `- ${p.key}: ${p.label}`).join('\n')}` },
    ] }],
  });
  const raw = ((toolInput(res) as { boxes?: unknown } | null)?.boxes ?? []) as Record<string, unknown>[];
  const keys = new Set(parts.map((p) => p.key));
  const out: { key: string; x: number; y: number; w: number; h: number }[] = [];
  for (const b of Array.isArray(raw) ? raw : []) {
    const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : NaN);
    const [x, y, w, h] = [n(b.x), n(b.y), n(b.w), n(b.h)];
    if (typeof b.part !== 'string' || !keys.has(b.part) || [x, y, w, h].some(Number.isNaN) || w <= 0 || h <= 0) continue;
    const cx = Math.min(Math.max(x, 0), 0.995), cy = Math.min(Math.max(y, 0), 0.995);
    out.push({ key: b.part, x: cx, y: cy, w: Math.min(w, 1 - cx), h: Math.min(h, 1 - cy) });
  }
  return out;
}

/** Stand-in pre-draw (tests and local demos): a neat row of boxes, one per part. */
export function locatePartsStub(parts: { key: string }[]) {
  return parts.map((p, i) => ({ key: p.key, x: 0.05 + (i % 3) * 0.31, y: 0.1 + Math.floor(i / 3) * 0.3, w: 0.28, h: 0.25 }));
}

const AUDIO_TYPES = ['audio/webm', 'audio/mp4', 'audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/x-m4a', 'audio/aac'];
/**
 * Turn a technician's spoken note into text (OpenAI speech-to-text). Used when the phone's own speech recognition
 * isn't available. The text goes into the technician's note field for them to read and edit; it's their words.
 */
export async function transcribeAudio(audio: { bytes: Uint8Array; type: string }): Promise<string> {
  const acct = currentAi();
  if (!acct || acct.provider !== 'openai') {
    throw new HttpError(503, 'Voice notes need an OpenAI key on the server or in Settings, because this phone can’t turn speech into text by itself.');
  }
  const type = audio.type.split(';')[0].trim().toLowerCase();
  if (!AUDIO_TYPES.includes(type)) throw new HttpError(415, 'That recording format isn’t supported.');
  const ext = type.includes('mp4') || type.includes('m4a') || type.includes('aac') ? 'm4a' : type.includes('mpeg') ? 'mp3' : type.split('/')[1];
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(audio.bytes)], { type }), `note.${ext}`);
  form.append('model', env('OPENAI_TRANSCRIBE_MODEL') ?? 'whisper-1');
  form.append('prompt', 'An auto repair technician describing vehicle inspection findings: brake pads, rotors, tread depth in 32nds, mm, psi, CV boots, leaks.');
  let r: Response;
  try {
    r = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST', headers: { authorization: `Bearer ${acct.key}` }, body: form, signal: AbortSignal.timeout(45_000),
    });
  } catch { throw new HttpError(504, 'Couldn’t reach the speech service. Try again.'); }
  if (!r.ok) {
    const t = await r.text();
    console.error('OpenAI transcription error', r.status, t.slice(0, 300));
    throw new HttpError(502, explainAiError(r.status, t, 'openai', acct.source));
  }
  const out = (await r.json()) as { text?: string };
  return (out.text ?? '').trim();
}
