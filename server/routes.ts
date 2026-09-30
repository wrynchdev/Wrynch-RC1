// HTTP endpoints. Each is deployed as its own function under /api/<name> (see scripts/build.mjs).
import { analyzePhotos, type PhotoAnalysis } from '../src/domain/aiStub';
import type { Inspection, Template, Vehicle } from '../src/domain/types';
import { aiMode, analyzePhoto, candidatesFor, mapTemplatePoints, mapTemplatePointsStub, model, readTemplate, rewriteNote, validateAnalysis, writePointNote, type DraftPoint } from './ai';
import { draftNote, pointFacts, type NoteStyle } from '../src/domain/noteDraft';
import { decodeVin } from './vin';
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

// POST /api/ai-sort { inspectionId, mediaIds }
export const aiSort: Handler = route({
  POST: async (req) => {
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
    for (const m of todo) { const g = `${m.sectionId}|${m.pointId ?? ''}`; bySection.set(g, [...(bySection.get(g) ?? []), m]); }

    const analyses: PhotoAnalysis[] = [];
    let failed = 0;
    let reason = '';
    const vehicleText = [vehicle.year || '', vehicle.make, vehicle.model, vehicle.trim].filter(Boolean).join(' ');
    for (const [group, items] of bySection) {
      const [sectionId, pointId] = [group.slice(0, group.indexOf('|')), group.slice(group.indexOf('|') + 1) || null];
      if (mode === 'claude') {
        const candidates = candidatesFor(template, sectionId, vehicle.config, pointId);
        const sec = template.sections.find((s) => s.id === sectionId);
        const pointName = pointId ? sec?.points.find((p) => p.id === pointId)?.name : undefined;
        const stage = `${sec?.name ?? sectionId}${pointName ? ` (taken for the inspection point "${pointName}")` : ''}`;
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
        analyses.push(...analyzePhotos(sectionId, items.map((m) => ({ id: m.id, name: m.label })), vehicle.config, template, pointId));
      }
    }
    if (todo.length && !analyses.length) throw new HttpError(502, `${reason || 'The AI couldn’t read these photos right now.'} Photos are saved; try “Sort with AI” again or place them by hand.`);
    if (analyses.length) await rpc('ai_record_sort', { p_inspection: inspectionId, p_items: analyses }, 'service');
    return json({
      photos: analyses.length, identified: analyses.filter((a) => a.parts.length).length,
      parts: analyses.reduce((n, a) => n + a.parts.length, 0), failed, reason, model: mode === 'claude' ? model() : 'stub',
    });
  },
});

// POST /api/ai-wording { inspectionId, pointId } -> { text, style }
// Rewrites the technician note in the shop's note style, or drafts one from confirmed facts when the note is blank.
// Stored as an ai_suggested note: it reaches the customer only after the technician approves it.
export const aiWording: Handler = route({
  POST: async (req) => {
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
      if (aiMode() === 'claude') {
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
  },
});

// POST /api/ai-note { inspectionId, pointId } -> { text, source: 'ai' | 'rules', basis: { parts, photos } }
// A draft technician note from the point's confirmed facts and confirmed photos. Nothing is stored: the draft
// becomes the note only when the technician approves it (set_note), so it can never reach a customer unapproved.
export const aiNote: Handler = route({
  POST: async (req) => {
    const jwt = bearer(req);
    const { inspectionId, pointId } = await readJson<{ inspectionId: string; pointId: string }>(req);
    const { inspection, vehicle, template } = await loadAsUser(jwt, inspectionId);
    if (inspection.status !== 'in_progress') throw new HttpError(409, 'This inspection is no longer open');
    const point = template.sections.flatMap((s) => s.points).find((p) => p.id === pointId);
    if (!point) throw new HttpError(404, 'Unknown inspection point');
    const facts = pointFacts(inspection, vehicle, point);
    if (!facts.parts.some((p) => p.state !== 'unrated')) throw new HttpError(400, 'Rate a part or confirm a photo on this point first');
    const basis = { parts: facts.parts.filter((p) => p.state !== 'unrated').length, photos: facts.photoIds.length };
    if (aiMode() === 'claude') {
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
  },
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
  GET: async () => json({ ai: aiMode() !== 'off', model: aiMode() === 'claude' ? model() : aiMode() }),
});

export const ROUTES: Record<string, Handler> = {
  status, pilot, 'ai-note': aiNote, 'template-read': templateRead, 'template-map': templateMap, 'ai-sort': aiSort, 'ai-wording': aiWording, vin, report, 'send-report': sendReport,
};
