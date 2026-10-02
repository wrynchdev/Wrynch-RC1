// HTTP endpoints. Each is deployed as its own function under /api/<name> (see scripts/build.mjs).
import { analyzePhotos, type PhotoAnalysis } from '../src/domain/aiStub';
import type { Inspection, Template, Vehicle } from '../src/domain/types';
import { aiMode, analyzePhoto, locateParts, locatePartsStub, candidatesFor, mapTemplatePoints, mapTemplatePointsStub, model, readTemplate, rewriteNote, validateAnalysis, writePointNote, type DraftPoint } from './ai';
import { draftNote, pointFacts, type NoteStyle } from '../src/domain/noteDraft';
import { CORNER_LABEL, isCorner } from '../src/domain/corner';
import { decodeVin } from './vin';
import { DEFAULT_ANTHROPIC_MODEL, withShopAi, type AiProvider, type ShopAi } from './aiContext';
import { lastFour, openSecret, sealSecret, secretsConfigured } from './secrets';
import { findRepairOrder, loadRepairOrder, roIdFromWebhook, tekmetricConfigured, webhookEvent, type RoImport } from './tekmetric';
import { detectorConfigured, detectParts } from './detector';
import { cls } from '../src/domain/ontology';
import { buildTekmetricExport } from '../src/domain/tekmetricExport';
import { clampBox, labelParts, toYoloManifest, type TrainingBox } from '../src/domain/training';
import { bearer, downloadObject, env, HttpError, json, rateLimit, readJson, route, rpc, signUrls, type Handler } from './lib';

interface InspectionBundle { inspection: Inspection; vehicle: Vehicle; template: Template }

/** Load an inspection as the signed-in user; the database refuses if they aren't in the shop. */
const loadAsUser = (jwt: string, id: string) => rpc<InspectionBundle>('get_inspection', { p_id: id }, jwt);

async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k]); }
  }));
  return out;
}

// ------------------------------------------------------------------ shop AI keys
/** The shop's own AI account for an inspection, if the owner saved a key; otherwise null (Wrynch's account is used). */
async function shopAiFor(inspectionId: unknown): Promise<ShopAi | null> {
  if (typeof inspectionId !== 'string' || !inspectionId) return null;
  let row: { shopId: string; provider: AiProvider; model: string | null; secret: string } | null = null;
  try { row = await rpc('shop_ai_key_secret', { p_inspection: inspectionId }, 'service'); } catch (e) { console.error('shop ai key lookup', e instanceof Error ? e.message : e); }
  if (!row?.secret) return null;
  return { provider: row.provider, model: row.model, key: await openSecret(row.secret, row.shopId) };
}
/** Run an AI route with the inspection's shop key in scope. Membership is still checked by the route itself
 * (it loads the inspection as the user) before any AI call is made. */
const withInspectionAi = (h: Handler): Handler => async (req) => {
  const body = (await req.clone().json().catch(() => ({}))) as { inspectionId?: unknown };
  return withShopAi(await shopAiFor(body?.inspectionId), () => h(req));
};

const PROVIDERS: AiProvider[] = ['anthropic', 'openai'];
const jwtSubject = (jwt: string): string | null => {
  try { return JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString()).sub ?? null; } catch { return null; }
};

/** Check a key with the provider before saving it; returns the model to use. Never logs or returns the key. */
export async function verifyProviderKey(provider: AiProvider, key: string, modelName: string): Promise<string> {
  const url = provider === 'openai' ? 'https://api.openai.com/v1/models' : 'https://api.anthropic.com/v1/models?limit=1000';
  const headers: Record<string, string> = provider === 'openai' ? { authorization: `Bearer ${key}` } : { 'x-api-key': key, 'anthropic-version': '2023-06-01' };
  let r: Response;
  try { r = await fetch(url, { headers, signal: AbortSignal.timeout(15_000) }); } catch { throw new HttpError(502, 'Couldn’t reach the AI provider to check the key. Try again.'); }
  const who = provider === 'openai' ? 'OpenAI' : 'Anthropic';
  if (r.status === 401 || r.status === 403) throw new HttpError(400, `${who} didn’t accept that key. Copy it again from your ${who} account.`);
  if (!r.ok) throw new HttpError(502, `${who} couldn’t check the key right now (${r.status}). Try again.`);
  const ids = (((await r.json()) as { data?: { id?: string }[] }).data ?? []).map((m) => m.id ?? '');
  const want = modelName.trim() || (provider === 'anthropic' ? env('ANTHROPIC_MODEL') ?? DEFAULT_ANTHROPIC_MODEL : '');
  if (!want) throw new HttpError(400, 'Choose the model to use with this key (for example one that can read photos).');
  if (ids.length && !ids.includes(want)) throw new HttpError(400, `This key can’t use the model “${want}”. Available models include: ${ids.slice(0, 6).join(', ')}.`);
  return want;
}

// POST /api/ai-key { shopId, provider, apiKey, model } -> key info (provider, model, last four)
// DELETE /api/ai-key { shopId }
// Owners only. The key is checked with the provider, encrypted here, and stored; it's never sent back.
export const aiKey: Handler = route({
  POST: async (req) => {
    const jwt = bearer(req);
    rateLimit(req, 'ai-key', 10, 10 * 60_000);
    const { shopId, provider, apiKey, model: modelName } = await readJson<{ shopId: string; provider: AiProvider; apiKey: string; model?: string }>(req);
    if (!shopId || !PROVIDERS.includes(provider)) throw new HttpError(400, 'Choose Anthropic or OpenAI');
    const key = String(apiKey ?? '').trim();
    if (key.length < 20 || key.length > 400 || /\s/.test(key)) throw new HttpError(400, 'That doesn’t look like an API key');
    await rpc('assert_shop_owner', { p_shop: shopId }, jwt);
    const useModel = await verifyProviderKey(provider, key, String(modelName ?? ''));
    await rpc('store_shop_ai_key', { p_shop: shopId, p_provider: provider, p_model: useModel, p_secret: await sealSecret(key, shopId), p_last4: lastFour(key), p_user: jwtSubject(jwt) }, 'service');
    return json(await rpc('shop_ai_key_info', { p_shop: shopId }, jwt));
  },
  DELETE: async (req) => {
    const jwt = bearer(req);
    const { shopId } = await readJson<{ shopId: string }>(req);
    await rpc('delete_shop_ai_key', { p_shop: shopId }, jwt);
    return json({ configured: false });
  },
});

// POST /api/ai-sort { inspectionId, mediaIds }
export const aiSort: Handler = route({
  POST: withInspectionAi(async (req) => {
    const jwt = bearer(req);
    const { inspectionId, mediaIds } = await readJson<{ inspectionId: string; mediaIds: string[] }>(req);
    if (!inspectionId || !Array.isArray(mediaIds) || mediaIds.length > 60) throw new HttpError(400, 'Send an inspection and up to 60 photos');
    const mode = aiMode();
    // Never pass off guesses as AI: without a key, photos stay unsorted for the technician to place.
    if (mode === 'off') throw new HttpError(503, 'AI photo sorting isn’t set up yet. Your photos are saved; place them by hand.');
    const { inspection, vehicle, template } = await loadAsUser(jwt, inspectionId);
    if (inspection.status !== 'in_progress') throw new HttpError(409, 'This inspection is no longer open');
    const todo = inspection.media.filter((m) => mediaIds.includes(m.id) && !m.excluded && !m.analyzed && m.links.length === 0);
    // Group by stage, and by point for photos taken from one point's camera button (only that point's parts are considered).
    const bySection = new Map<string, typeof todo>();
    // Photos from the in-app camera can carry a corner tag (LF/RF/LR/RR): only parts that fit that corner are considered.
    for (const m of todo) { const g = `${m.sectionId}|${m.pointId ?? ''}|${isCorner(m.corner) ? m.corner : ''}`; bySection.set(g, [...(bySection.get(g) ?? []), m]); }

    const analyses: PhotoAnalysis[] = [];
    let failed = 0;
    let reason = '';
    const vehicleText = [vehicle.year || '', vehicle.make, vehicle.model, vehicle.trim].filter(Boolean).join(' ');
    for (const [group, items] of bySection) {
      const [sectionId, pointPart, cornerPart] = group.split('|');
      const pointId = pointPart || null;
      const corner = isCorner(cornerPart) ? cornerPart : null;
      if (mode === 'live') {
        const candidates = candidatesFor(template, sectionId, vehicle.config, pointId, corner);
        const sec = template.sections.find((s) => s.id === sectionId);
        const pointName = pointId ? sec?.points.find((p) => p.id === pointId)?.name : undefined;
        const stage = `${sec?.name ?? sectionId}${pointName ? ` (taken for the inspection point "${pointName}")` : ''}${corner ? `; the technician tagged this photo as taken at the ${CORNER_LABEL[corner].toLowerCase()} corner of the vehicle` : ''}`;
        const results = await pool(items, 4, async (m) => {
          try {
            return validateAnalysis(m.id, await analyzePhoto(await downloadObject(m.url), candidates, stage, vehicleText), candidates);
          } catch (e) {
            // Not recorded, so the photo stays "not sorted" and can be retried.
            console.error('photo', m.id, e);
            failed++;
            if (!reason) reason = e instanceof HttpError ? e.message : 'The AI couldn’t read this photo.';
            return null;
          }
        });
        analyses.push(...results.filter((a): a is PhotoAnalysis => a !== null));
      } else {
        // AI_STUB=1 (tests and local demos only): the rule-based stand-in.
        analyses.push(...analyzePhotos(sectionId, items.map((m) => ({ id: m.id, name: m.label })), vehicle.config, template, pointId, corner));
      }
    }
    if (todo.length && !analyses.length) throw new HttpError(502, `${reason || 'The AI couldn’t read these photos right now.'} Photos are saved; try “Sort with AI” again or place them by hand.`);
    if (analyses.length) await rpc('ai_record_sort', { p_inspection: inspectionId, p_items: analyses }, 'service');
    return json({
      photos: analyses.length, identified: analyses.filter((a) => a.parts.length).length,
      parts: analyses.reduce((n, a) => n + a.parts.length, 0), failed, reason, model: mode === 'live' ? model() : 'stub',
    });
  }),
});

// POST /api/ai-wording { inspectionId, pointId } -> { text, style }
// Rewrites the technician note in the shop's note style, or drafts one from confirmed facts when the note is blank.
// Stored as an ai_suggested note: it reaches the customer only after the technician approves it.
export const aiWording: Handler = route({
  POST: withInspectionAi(async (req) => {
    const jwt = bearer(req);
    const { inspectionId, pointId } = await readJson<{ inspectionId: string; pointId: string }>(req);
    const { inspection, vehicle, template } = await loadAsUser(jwt, inspectionId);
    if (inspection.status !== 'in_progress') throw new HttpError(409, 'This inspection is no longer open');
    const point = template.sections.flatMap((s) => s.points).find((p) => p.id === pointId);
    if (!point) throw new HttpError(404, 'Unknown inspection point');
    const style: NoteStyle = (await rpc<string | null>('note_style_for', { p_inspection: inspectionId }, jwt).catch(() => null)) === 'technical' ? 'technical' : 'customer';
    const note = inspection.notes.find((n) => n.pointId === pointId);
    let text: string | null;
    if (note?.techText.trim()) {
      // The technician wrote a note: reword it in the shop's style, keeping every number.
      text = await rewriteNote(note, point.name, style);
      if (!text) throw new HttpError(422, "Couldn't reword this note without changing its numbers; keep yours");
    } else {
      // Blank note: draft one from the point's confirmed facts only.
      const facts = pointFacts(inspection, vehicle, point);
      if (!facts.parts.some((p) => p.state !== 'unrated')) throw new HttpError(400, 'Nothing confirmed on this point to write about');
      text = null;
      if (aiMode() === 'live') {
        try {
          const media = inspection.media.filter((m) => facts.photoIds.includes(m.id)).slice(0, 3);
          const photos = (await Promise.all(media.map((m) => downloadObject(m.url).catch(() => null)))).filter((x): x is { bytes: Uint8Array; type: string } => !!x);
          text = await writePointNote(facts, photos, style);
        } catch (e) {
          console.error('ai-wording draft', e);
        }
      }
      text ??= draftNote(facts, style);
    }
    await rpc('ai_record_wording', { p_inspection: inspectionId, p_point: pointId, p_text: text }, 'service');
    return json({ text, style });
  }),
});

// POST /api/ai-note { inspectionId, pointId } -> { text, source: 'ai' | 'rules', basis: { parts, photos } }
// A draft technician note from the point's confirmed facts and confirmed photos. Nothing is stored: the draft
// becomes the note only when the technician approves it (set_note), so it can never reach a customer unapproved.
export const aiNote: Handler = route({
  POST: withInspectionAi(async (req) => {
    const jwt = bearer(req);
    const { inspectionId, pointId } = await readJson<{ inspectionId: string; pointId: string }>(req);
    const { inspection, vehicle, template } = await loadAsUser(jwt, inspectionId);
    if (inspection.status !== 'in_progress') throw new HttpError(409, 'This inspection is no longer open');
    const point = template.sections.flatMap((s) => s.points).find((p) => p.id === pointId);
    if (!point) throw new HttpError(404, 'Unknown inspection point');
    const facts = pointFacts(inspection, vehicle, point);
    if (!facts.parts.some((p) => p.state !== 'unrated')) throw new HttpError(400, 'Rate a part or confirm a photo on this point first');
    const basis = { parts: facts.parts.filter((p) => p.state !== 'unrated').length, photos: facts.photoIds.length };
    if (aiMode() === 'live') {
      try {
        const media = inspection.media.filter((m) => facts.photoIds.includes(m.id)).slice(0, 3);
        const photos = (await Promise.all(media.map((m) => downloadObject(m.url).catch(() => null)))).filter((x): x is { bytes: Uint8Array; type: string } => !!x);
        const text = await writePointNote(facts, photos);
        if (text) return json({ text, source: 'ai', basis });
      } catch (e) {
        console.error('ai-note', e);
      }
    }
    return json({ text: draftNote(facts), source: 'rules', basis });
  }),
});

// GET /api/vin?vin=...
export const vin: Handler = route({
  GET: async (req) => {
    bearer(req); // only for signed-in users, so this isn't an open proxy
    const v = new URL(req.url).searchParams.get('vin') ?? '';
    return json(await decodeVin(v));
  },
});

// GET /api/report?token=...   POST /api/report { token, key, approved }
// Customers aren't signed in; the long random token in their link is the secret.
export const report: Handler = route({
  GET: async (req) => {
    const token = new URL(req.url).searchParams.get('token') ?? '';
    if (!/^[a-f0-9]{64}$/.test(token)) throw new HttpError(404, "This report link isn't valid");
    const doc = await rpc<InspectionBundle & { shop: { name: string; phone: string | null } }>('customer_report', { p_token: token }, 'service');
    const urls = await signUrls(doc.inspection.media.map((m) => m.url));
    for (const m of doc.inspection.media) m.url = urls[m.url] ?? '';
    return json(doc);
  },
  POST: async (req) => {
    const { token, key, approved } = await readJson<{ token: string; key: string; approved: boolean }>(req);
    if (!/^[a-f0-9]{64}$/.test(token ?? '')) throw new HttpError(404, "This report link isn't valid");
    await rpc('customer_set_approval', { p_token: token, p_key: key, p_approved: !!approved }, 'service');
    return json({ ok: true });
  },
});

// POST /api/send-report { inspectionId, channel: 'sms' | 'email' | 'link', to? }
export const sendReport: Handler = route({
  POST: async (req) => {
    const jwt = bearer(req);
    const { inspectionId, channel, to } = await readJson<{ inspectionId: string; channel: 'sms' | 'email' | 'link'; to?: string }>(req);
    const { inspection, vehicle } = await loadAsUser(jwt, inspectionId);
    if (inspection.status !== 'submitted' && inspection.status !== 'sent') throw new HttpError(409, 'Send to advisor first');
    const link = `${appRoot(req)}#/r/${inspection.reportToken}`;
    const who = `${vehicle.year ?? ''} ${vehicle.make} ${vehicle.model}`.trim();
    let status: 'sent' | 'failed' | 'skipped' = 'skipped';
    let detail = '';
    let dest: string | null = null;
    if (channel === 'sms') {
      dest = (to ?? vehicle.customerPhone ?? '').trim();
      if (!dest) throw new HttpError(400, 'Add a phone number for this customer');
      ({ status, detail } = await sendSms(dest, `Your ${who} inspection report is ready: ${link}`));
    } else if (channel === 'email') {
      dest = (to ?? vehicle.customerEmail ?? '').trim();
      if (!dest) throw new HttpError(400, 'Add an email address for this customer');
      ({ status, detail } = await sendEmail(dest, `Your ${who} inspection report`, `Your ${who} inspection report is ready.\n\n${link}\n`));
    }
    await rpc('mark_sent', { p_inspection: inspectionId, p_channel: channel, p_destination: dest, p_status: channel === 'link' ? 'sent' : status, p_detail: detail || null }, jwt);
    if (status === 'failed') throw new HttpError(502, `Couldn't send: ${detail}. Copy the link instead.`);
    return json({ link, status: channel === 'link' ? 'sent' : status, detail });
  },
});

async function sendSms(to: string, body: string): Promise<{ status: 'sent' | 'failed' | 'skipped'; detail: string }> {
  const sid = env('TWILIO_ACCOUNT_SID'), tok = env('TWILIO_AUTH_TOKEN'), from = env('TWILIO_FROM');
  if (!sid || !tok || !from) return { status: 'skipped', detail: 'Text messaging is not set up' };
  const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: { authorization: `Basic ${Buffer.from(`${sid}:${tok}`).toString('base64')}`, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ To: to, From: from, Body: body }),
  });
  return r.ok ? { status: 'sent', detail: '' } : { status: 'failed', detail: `text service error ${r.status}` };
}

async function sendEmail(to: string, subject: string, text: string): Promise<{ status: 'sent' | 'failed' | 'skipped'; detail: string }> {
  const key = env('RESEND_API_KEY'), from = env('EMAIL_FROM');
  if (!key || !from) return { status: 'skipped', detail: 'Email is not set up' };
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from, to, subject, text }),
  });
  return r.ok ? { status: 'sent', detail: '' } : { status: 'failed', detail: `email service error ${r.status}` };
}

/**
 * Where the app lives for links we send out. On the app's own domain that's the shop's address the request came
 * from (https://1001.wrynch.app/); elsewhere (previews, local) it's the /app/ path of APP_URL or this site.
 */
export function appRoot(req: Request): string {
  const url = new URL(req.url);
  const domain = (env('APP_DOMAIN') ?? 'wrynch.app').toLowerCase();
  const host = url.host.toLowerCase().split(':')[0];
  if (host === domain || host.endsWith(`.${domain}`)) return `https://${url.host}/`;
  return `${(env('APP_URL') ?? url.origin).replace(/\/$/, '')}/app/`;
}

// ------------------------------------------------------------------ public marketing-site endpoints

const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

// POST /api/pilot { shopName, contactName, email, phone?, location?, techs?, currentTool?, notes?, template?, website? }
// A shop applies for the pilot program. Stored with the service key; the owner is emailed if email is set up.
export const pilot: Handler = route({
  POST: async (req) => {
    rateLimit(req, 'pilot', 5, 3600_000);
    const b = await readJson<Record<string, unknown>>(req);
    if (text(b.website, 200)) return json({ ok: true }); // honeypot field: bots fill it, people don't see it
    const app = {
      shopName: text(b.shopName, 120), contactName: text(b.contactName, 120), email: text(b.email, 200).toLowerCase(),
      phone: text(b.phone, 40), location: text(b.location, 120), currentTool: text(b.currentTool, 120), notes: text(b.notes, 2000),
      techs: Number.isFinite(Number(b.techs)) && String(b.techs ?? '').trim() !== '' ? Math.max(0, Math.min(500, Math.round(Number(b.techs)))) : '',
      template: b.template && typeof b.template === 'object' && JSON.stringify(b.template).length < 150_000 ? b.template : null,
    };
    if (!app.shopName || !app.contactName) throw new HttpError(400, 'Add your shop name and your name.');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(app.email)) throw new HttpError(400, 'That email address doesn’t look right.');
    const id = await rpc<string>('record_pilot_request', { p: app }, 'service');
    const notify = env('PILOT_NOTIFY_EMAIL');
    if (notify) {
      const facts = [
        `Shop: ${app.shopName}`, `Email: ${app.email}`, app.phone && `Phone: ${app.phone}`, app.location && `Location: ${app.location}`,
        app.techs !== '' && `Technicians: ${app.techs}`, app.currentTool && `Uses today: ${app.currentTool}`, app.notes && `Notes: ${app.notes}`,
        app.template && 'They also uploaded their inspection template (saved with the application).',
      ].filter((x): x is string => typeof x === 'string' && x !== '');
      const lines = [`${app.contactName} applied for the Wrynch pilot.`, '', ...facts, '',
        'To approve, run this in the Supabase SQL editor and send them the link it returns:', `select public.approve_pilot_request('${id}');`];
      await sendEmail(notify, `Pilot application: ${app.shopName}`, lines.join('\n')).catch(() => undefined);
    }
    return json({ ok: true });
  },
});

// POST /api/template-read (body: the PDF or image) -> { name, points: [{ stage, name, detail }] }
export const templateRead: Handler = route({
  POST: async (req) => {
    const mode = aiMode();
    if (mode === 'off') throw new HttpError(503, 'Template reading isn’t available right now.');
    rateLimit(req, 'template-read', 8, 3600_000);
    const type = (req.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    const bytes = new Uint8Array(await req.arrayBuffer());
    if (!bytes.length) throw new HttpError(400, 'Choose a PDF or photo of your inspection sheet.');
    if (bytes.length > 4_000_000) throw new HttpError(413, 'That file is over 4 MB. Try a photo of the sheet, or a smaller PDF.');
    if (mode === 'stub') {
      if (!['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(type)) throw new HttpError(415, 'Upload a PDF or a photo (JPEG or PNG) of your inspection sheet.');
      return json({ name: 'Sample sheet (stand-in)', points: ['Brakes', 'Tires', 'Lights', 'Wipers', 'Battery', 'Customer concern'].map((name) => ({ stage: 'Inspection', name })) });
    }
    const out = await readTemplate({ bytes, type });
    if (!out.points.length) throw new HttpError(422, 'We couldn’t find inspection items in that file. Try a clearer photo or the PDF of your sheet.');
    return json(out);
  },
});

// POST /api/template-map { points: [{ stage, name, detail }] } (up to 15) -> { points: MappedPoint[] }
export const templateMap: Handler = route({
  POST: async (req) => {
    const mode = aiMode();
    if (mode === 'off') throw new HttpError(503, 'Template reading isn’t available right now.');
    rateLimit(req, 'template-map', 60, 3600_000);
    const b = await readJson<{ points?: unknown }>(req);
    const points: DraftPoint[] = (Array.isArray(b.points) ? b.points : []).slice(0, 15).map((p) => {
      const x = p as Record<string, unknown>;
      return { stage: text(x.stage, 60) || 'Inspection', name: text(x.name, 120), detail: text(x.detail, 200) || undefined };
    }).filter((p) => p.name);
    if (!points.length) throw new HttpError(400, 'No inspection items to map.');
    return json({ points: mode === 'stub' ? mapTemplatePointsStub(points) : await mapTemplatePoints(points) });
  },
});

// GET /api/status: whether AI photo sorting is available (no secrets, no sign-in).
export const status: Handler = route({
  GET: async () => json({ ai: aiMode() !== 'off', model: aiMode() === 'live' ? model() : aiMode(), tekmetric: tekmetricConfigured(), detector: detectorConfigured(), shopKeys: secretsConfigured() }),
});

// ------------------------------------------------------------------ Tekmetric

const importRo = async (shopId: string, ro: RoImport) => {
  const inspectionId = await rpc<string>('tekmetric_import_ro', { p_shop: shopId, p_ro: ro }, 'service');
  await rpc('tekmetric_log', { p_shop: shopId, p_kind: 'import', p_ro: ro.roId, p_inspection: inspectionId, p_status: 'ok',
    p_detail: `RO ${ro.roNumber || ro.roId} · ${[ro.year, ro.make, ro.model].filter(Boolean).join(' ')}${ro.technician ? ` · ${ro.technician}` : ''}` }, 'service');
  return inspectionId;
};

// POST /api/tekmetric-webhook?token=<shop's webhook token>
// Tekmetric calls this when a repair order is created (or changes). The token in the address identifies the shop;
// the repair order itself is always re-read from Tekmetric's API, never trusted from the request body.
export const tekmetricWebhook: Handler = route({
  POST: async (req) => {
    const token = new URL(req.url).searchParams.get('token') ?? '';
    rateLimit(req, 'tm-webhook', 240, 60_000);
    const link = token.length >= 32 ? await rpc<{ shopId: string; tekmetricShopId: number; enabled: boolean } | null>('tekmetric_shop_for_token', { p_token: token }, 'service') : null;
    if (!link) throw new HttpError(404, 'Unknown webhook address');
    const body = await req.json().catch(() => null);
    const roId = roIdFromWebhook(body);
    const event = webhookEvent(body);
    const log = (status: string, detail: string, inspectionId: string | null = null) =>
      rpc('tekmetric_log', { p_shop: link.shopId, p_kind: 'webhook', p_ro: roId, p_inspection: inspectionId, p_status: status, p_detail: detail }, 'service');
    if (!link.enabled) { await log('skipped', `${event}: Tekmetric sync is turned off for this shop`); return json({ ok: true, skipped: 'disabled' }); }
    if (!roId) { await log('skipped', `${event}: no repair order in this notification`); return json({ ok: true, skipped: 'no repair order' }); }
    if (!tekmetricConfigured()) { await log('skipped', `${event}: Tekmetric API credentials aren't set up on the server yet`); return json({ ok: true, skipped: 'not configured' }, 202); }
    try {
      const inspectionId = await importRo(link.shopId, await loadRepairOrder(link.tekmetricShopId, roId));
      return json({ ok: true, inspectionId });
    } catch (e) {
      await log('error', `${event}: ${e instanceof Error ? e.message : 'import failed'}`);
      return json({ ok: false }, 200); // recorded for the shop to see; no point in Tekmetric retrying the same failure
    }
  },
});

// POST /api/tekmetric-import { shopId, roNumber } -> { inspectionId }
// Pull one repair order by number (for ROs created before the shop connected, or a missed notification).
export const tekmetricImport: Handler = route({
  POST: async (req) => {
    const jwt = bearer(req);
    const { shopId, roNumber } = await readJson<{ shopId: string; roNumber: string }>(req);
    if (!shopId || !String(roNumber ?? '').trim()) throw new HttpError(400, 'Enter a repair order number');
    const link = await rpc<{ linked: boolean; tekmetricShopId: number | null; enabled: boolean }>('tekmetric_link_for', { p_shop: shopId }, jwt);
    if (!link.linked || !link.tekmetricShopId) throw new HttpError(409, 'Connect Tekmetric in Settings first');
    if (!link.enabled) throw new HttpError(409, 'Tekmetric sync is turned off in Settings');
    if (!tekmetricConfigured()) throw new HttpError(503, 'Tekmetric isn’t connected on the server yet (API credentials missing).');
    const ro = await findRepairOrder(link.tekmetricShopId, String(roNumber));
    return json({ inspectionId: await importRo(shopId, ro) });
  },
});

// POST /api/tekmetric-export { inspectionId } -> { written, text, export }
// Owners and advisors, after review. Builds the export from approved, technician-confirmed content only: each
// point's rating, customer note and photo count, the estimate with the customer's decisions, and the report link.
// Tekmetric's API has no inspection endpoints, and its repair-order write calls are only documented to approved
// developers, so until those are confirmed the export is returned as text for the advisor to paste into the RO.
export const tekmetricExport: Handler = route({
  POST: async (req) => {
    const jwt = bearer(req);
    const { inspectionId } = await readJson<{ inspectionId: string }>(req);
    const info = await rpc<{ shopId: string; roId: number | null; status: string }>('tekmetric_export_info', { p_inspection: inspectionId }, jwt);
    if (!info.roId) throw new HttpError(409, 'This inspection didn’t come from a Tekmetric repair order');
    if (info.status !== 'submitted' && info.status !== 'sent') throw new HttpError(409, 'Finish the review before exporting');
    const { inspection, vehicle, template } = await loadAsUser(jwt, inspectionId);
    const out = buildTekmetricExport(inspection, vehicle, template, `${appRoot(req)}#/r/${inspection.reportToken}`);
    await rpc('tekmetric_log', { p_shop: info.shopId, p_kind: 'export', p_ro: info.roId, p_inspection: inspectionId, p_status: 'skipped',
      p_detail: `RO ${inspection.ro || info.roId}: ${out.points.length} points prepared to paste into Tekmetric` }, 'service');
    // Remembered so the advisor sees "Export to Tekmetric again" next time.
    await rpc('tekmetric_mark_exported', { p_inspection: inspectionId }, 'service');
    return json({ written: false, reason: 'Writing to Tekmetric isn’t switched on yet, so copy this into the repair order.', text: out.text, export: out });
  },
});

// ------------------------------------------------------------------ training data (Wrynch staff only)

// GET /api/training -> { items: [{ mediaId, url, shop, vehicle, stage, parts }], stats }
// The next photos to label from shops that share training data, with short-lived photo links.
export const training: Handler = route({
  GET: async (req) => {
    const jwt = bearer(req);
    const [items, stats] = await Promise.all([
      rpc<{ mediaId: string; path: string; shop: number; vehicle: string; stage: string; parts: string[] }[]>('training_queue', { p_limit: 20 }, jwt),
      rpc<Record<string, unknown>>('training_stats', {}, jwt),
    ]);
    const urls = await signUrls(items.map((x) => x.path), 3600);
    return json({ items: items.map(({ path, ...x }) => ({ ...x, url: urls[path] ?? null })), stats });
  },
});

// POST /api/training-suggest { mediaId } -> { boxes } : AI first-guess boxes for staff to correct. Nothing is stored.
export const trainingSuggest: Handler = route({
  POST: async (req) => {
    const jwt = bearer(req);
    const { mediaId } = await readJson<{ mediaId: string }>(req);
    const photo = await rpc<{ path: string; parts: string[] }>('training_photo', { p_media: mediaId }, jwt);
    const parts = labelParts(photo.parts ?? []);
    const mode = aiMode();
    // The part detector (Grounding DINO or similar) draws the first guess when it's set up; the chat AI otherwise,
    // or if the detector fails.
    let found: { key: string; x: number; y: number; w: number; h: number }[] | null = null;
    let by: 'detector' | 'ai' = 'ai';
    let image: { bytes: Uint8Array; type: string } | null = null;
    if (detectorConfigured()) {
      try {
        image = await downloadObject(photo.path);
        found = await detectParts(image, parts.map((p) => ({ key: p.key, label: cls(p.classId).label })));
        by = 'detector';
      } catch (e) { console.error('part detector failed; using the AI instead', e instanceof Error ? e.message : e); }
    }
    if (!found) {
      if (mode === 'off') return json({ boxes: [], note: 'AI isn’t set up, so draw the boxes by hand.' });
      found = mode === 'stub' ? locatePartsStub(parts) : await locateParts(image ?? await downloadObject(photo.path), parts);
    }
    const boxes: TrainingBox[] = found.map((b) => {
      const p = parts.find((x) => x.key === b.key)!;
      return clampBox({ classId: p.classId, position: p.position, x: b.x, y: b.y, w: b.w, h: b.h, source: 'ai' as const });
    });
    return json({ boxes, by });
  },
});

// GET /api/training-export -> the dataset manifest (YOLO rows, classes, photo links valid for 7 days) as a download.
export const trainingExport: Handler = route({
  GET: async (req) => {
    const jwt = bearer(req);
    const rows = await rpc<{ mediaId: string; path: string; width: number | null; height: number | null; boxes: TrainingBox[] }[]>('training_export', {}, jwt);
    const urls: Record<string, string> = {};
    for (let i = 0; i < rows.length; i += 500) Object.assign(urls, await signUrls(rows.slice(i, i + 500).map((r) => r.path), 7 * 24 * 3600));
    const manifest = toYoloManifest(rows.filter((r) => urls[r.path]).map((r) => ({ mediaId: r.mediaId, url: urls[r.path], width: r.width, height: r.height, boxes: r.boxes })));
    return new Response(JSON.stringify(manifest), { headers: {
      'content-type': 'application/json', 'cache-control': 'no-store',
      'content-disposition': `attachment; filename="wrynch-dataset-${manifest.createdAt.slice(0, 10)}.json"`,
    } });
  },
});

export const ROUTES: Record<string, Handler> = {
  status, pilot, 'ai-note': aiNote, 'template-read': templateRead, 'template-map': templateMap, 'ai-sort': aiSort, 'ai-wording': aiWording, vin, report, 'send-report': sendReport,
  'ai-key': aiKey, training, 'training-suggest': trainingSuggest, 'training-export': trainingExport, 'tekmetric-webhook': tekmetricWebhook, 'tekmetric-import': tekmetricImport, 'tekmetric-export': tekmetricExport,
};

/**
 * All routes behind one server function (Vercel's free plan allows 12 per deployment). Requests to /api/<name> are
 * rewritten to this function with ?route=<name>; the name is also read from the path in case the rewrite keeps it.
 */
export const apiRouter: Handler = async (req) => {
  const url = new URL(req.url);
  const name = url.searchParams.get('route') || /\/api\/([a-z-]+)\/?$/.exec(url.pathname)?.[1] || '';
  const handler = Object.hasOwn(ROUTES, name) ? ROUTES[name] : null;
  if (!handler) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers: { 'content-type': 'application/json' } });
  url.searchParams.delete('route');
  url.pathname = `/api/${name}`;
  const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : await req.arrayBuffer();
  return handler(new Request(url, { method: req.method, headers: req.headers, body }));
};
