// HTTP endpoints. Each is deployed as its own function under /api/<name> (see scripts/build.mjs).
import { sortPhotos } from '../src/domain/aiStub';
import type { Inspection, Template, Vehicle } from '../src/domain/types';
import { candidatesFor, classifyPhoto, rewriteNote, validateProposal, type Proposal } from './ai';
import { decodeVin } from './vin';
import { bearer, downloadObject, env, HttpError, json, readJson, route, rpc, signUrls, type Handler } from './lib';

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
    const { inspection, vehicle, template } = await loadAsUser(jwt, inspectionId);
    if (inspection.status !== 'in_progress') throw new HttpError(409, 'This inspection is no longer open');
    const todo = inspection.media.filter((m) => mediaIds.includes(m.id) && m.status === 'unassigned' && !m.aiGuess);
    const bySection = new Map<string, typeof todo>();
    for (const m of todo) bySection.set(m.sectionId, [...(bySection.get(m.sectionId) ?? []), m]);

    const proposals: Proposal[] = [];
    const useModel = !!env('ANTHROPIC_API_KEY');
    for (const [sectionId, items] of bySection) {
      const candidates = candidatesFor(template, sectionId, vehicle.config);
      const stage = template.sections.find((s) => s.id === sectionId)?.name ?? sectionId;
      if (useModel) {
        proposals.push(...await pool(items, 4, async (m) => {
          try {
            const raw = await classifyPhoto(await downloadObject(m.url), candidates, stage);
            return validateProposal(m.id, raw, candidates);
          } catch (e) {
            console.error('photo', m.id, e);
            return { mediaId: m.id, pointId: null, key: null, confidence: 0, finding: null } as Proposal;
          }
        }));
      } else {
        // No AI key configured: the deterministic stand-in keeps the workflow usable.
        const out = sortPhotos(sectionId, items.map((m) => ({ id: m.id, url: m.url, name: m.label })), vehicle.config, new Date().toISOString(), template);
        for (const m of out.media) {
          const f = out.findings.find((x) => x.mediaId === m.id);
          proposals.push({
            mediaId: m.id, pointId: m.pointId, key: m.compKey, confidence: m.confidence ?? 0,
            finding: f ? { key: f.key, severity: f.severity, confidence: f.confidence ?? 0, rationale: f.rationale ?? '' } : null,
          });
        }
      }
    }
    await rpc('ai_record_sort', { p_inspection: inspectionId, p_items: proposals }, 'service');
    return json({ sorted: proposals.filter((p) => p.key).length, unsure: proposals.filter((p) => !p.key).length, model: useModel ? 'claude' : 'stub' });
  },
});

// POST /api/ai-wording { inspectionId, pointId }
export const aiWording: Handler = route({
  POST: async (req) => {
    const jwt = bearer(req);
    const { inspectionId, pointId } = await readJson<{ inspectionId: string; pointId: string }>(req);
    const { inspection, template } = await loadAsUser(jwt, inspectionId);
    if (inspection.status !== 'in_progress') throw new HttpError(409, 'This inspection is no longer open');
    const note = inspection.notes.find((n) => n.pointId === pointId);
    if (!note || !note.techText.trim()) throw new HttpError(400, 'Write a note first');
    const pointName = template.sections.flatMap((s) => s.points).find((p) => p.id === pointId)?.name ?? pointId;
    const text = await rewriteNote(note, pointName);
    if (!text) throw new HttpError(422, "Couldn't reword this note without changing its numbers; keep yours");
    await rpc('ai_record_wording', { p_inspection: inspectionId, p_point: pointId, p_text: text }, 'service');
    return json({ text });
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
    const base = env('APP_URL') ?? new URL(req.url).origin;
    const link = `${base.replace(/\/$/, '')}/#/r/${inspection.reportToken}`;
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

export const ROUTES: Record<string, Handler> = {
  'ai-sort': aiSort, 'ai-wording': aiWording, vin, report, 'send-report': sendReport,
};
