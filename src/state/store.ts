// App state and every action the screens can take.
//
// Two modes share one set of actions:
//  * demo — no backend configured: seeded data kept in this browser.
//  * live — Supabase configured at build time: the change is shown immediately, sent to the database
//    function that enforces the rules, then the inspection is reloaded from the server (the source of truth).
import { useSyncExternalStore } from 'react';
import {
  aiFilingCheck, cls, DEFAULT_TEMPLATE, ONTOLOGY, parseKey, partsLeftWithoutChecks, point as getPoint, pointComponents, setDisabledChecks, setTemplate, setThresholds, withTemplate,
  type Threshold,
} from '../domain/ontology';
import { completionGate, findingRating, rateValue, summarize, type Summary } from '../domain/rating';
import { inspectionSteps } from '../domain/progress';
import { applyUnderCarExample, DEMO_TEMPLATE_ID, quickCheck, seedInspections, VEHICLES } from '../domain/seed';
import { declinedWork, type DeclinedItem, type Followup, type FollowupStatus } from '../domain/declined';
import { analyzePhotos, applyAnalysis, suggestWording, wordingKeepsFacts } from '../domain/aiStub';
import type {
  CompKey, EstimateLine, Finding, Inspection, NotInspectedReason, Rating, Severity, Template, Vehicle, VehicleConfig,
} from '../domain/types';
import { ApiError, auth, fn, fnBlob, getSession, hostInfo, LIVE, onSession, rpc, rpcAnon, shared, shrinkPhoto, signPhotos, upload, type Session } from './remote';
import { dashFromInspections, type DashData } from '../domain/dashboard';
export type { DeclinedItem, Followup, FollowupStatus };
import { draftNote, pointFacts, type NoteStyle } from '../domain/noteDraft';
import type { Corner } from '../domain/corner';
import type { TrainingBox } from '../domain/training';

export type Role = 'owner' | 'advisor' | 'technician';
export interface Member { userId: string; name: string; role: Role }
export interface Workspace {
  shops: { id: string; name: string; role: Role; number?: number }[];
  shop: { id: string; name: string; phone: string | null; number?: number; noteStyle?: NoteStyle } | null;
  role: Role | null;
  me: { userId: string; name: string } | null;
  members: Member[];
  invites: { email: string; role: Role; token: string; createdAt: string }[];
  /** The shop's default template (the version in use). */
  template: { id: string; family?: string; version: number; data: Template } | null;
  /** Every template the shop can start an inspection on, default first. */
  templates: TemplateEntry[];
  rules: { id: string; number: number; thresholds: Threshold[] } | null;
}
/** One of the shop's inspection templates: `family` stays the same across versions, `id` is the version in use. */
export interface TemplateEntry { id: string; family: string; version: number; name: string; isDefault: boolean; data: Template }
export interface JobHeader {
  id: string; ro: string; status: Inspection['status']; date: string; odometer: number; technician: string;
  concerns: string[]; summary: Summary | null; pendingAi: number; vehicle: Vehicle;
  templateId?: string | null; templateName?: string | null;
}
export interface State {
  mode: 'demo' | 'live';
  vehicles: Vehicle[];
  inspections: Inspection[];
  session: Session | null;
  workspace: Workspace | null;
  jobs: JobHeader[];
  loading: number;
  busy: string | null;
  toast: { text: string; kind: 'error' | 'info' } | null;
  photoUrls: Record<string, string>;
  /** Live mode: whether real AI photo sorting is available (null until checked). */
  ai: { on: boolean; model: string; tekmetric?: boolean; shopKeys?: boolean } | null;
  /** The shop's own AI key, if the owner saved one (only the provider, model and last four characters). */
  shopAi: ShopAiInfo | null;
  /** Checks turned off Wrynch-wide (by staff) and for this shop (by the owner); `admin` = the user is Wrynch staff. */
  checksOff: ChecksOff;
  /** Whether this shop shares confirmed photos for training, and whether the user is Wrynch staff. */
  training: { shared: boolean; admin: boolean } | null;
  /** The shop's Tekmetric link and recent sync activity (live mode, loaded on demand). */
  tekmetric: TekmetricLink | null;
  /** Shop dashboard for the chosen range (live: from the server; demo: from the inspections here). */
  dashboard: DashData | null;
  /** Demo only: the note style (live shops keep theirs on the shop). */
  demoNoteStyle: NoteStyle;
  /** Demo only: the before-Wrynch approval rate. */
  demoBaseline?: number | null;
  /** Demo only: the shop's templates (live shops get theirs with the workspace). */
  demoTemplates: TemplateEntry[];
  /** Template versions by id, for the inspections that use them (live: from each inspection's bundle). */
  templateDocs: Record<string, Template>;
  /** Declined-work follow-ups (live: loaded with the declined-work list; demo: kept in this browser). */
  followups: Followup[];
  /** Live: the visits behind declined work (every visit of each vehicle with a recent sent report). */
  declinedData: { inspections: Inspection[]; vehicles: Vehicle[] } | null;
}

const STORAGE_KEY = 'wrynch-demo-v4'; // bumped when the saved demo data shape changes
const now = () => new Date().toISOString();
let seq = Date.now();
const uid = (p: string) => `${p}-${(seq++).toString(36)}`;

function demoInitial(): State {
  const templates = demoTemplateSeed();
  return {
    mode: 'demo', vehicles: structuredClone(VEHICLES), inspections: seedInspections(), demoNoteStyle: 'customer', tekmetric: null, shopAi: null, training: null, checksOff: { platform: [], shop: [], admin: false },
    session: null, workspace: null, jobs: [], loading: 0, busy: null, toast: null, photoUrls: {}, ai: null, dashboard: null,
    demoTemplates: templates, templateDocs: Object.fromEntries(templates.map((t) => [t.id, t.data])), followups: [], declinedData: null,
  };
}

/** Demo templates: the standard one, and a courtesy check that only looks at the brakes (no measurements). */
function demoTemplateSeed(): TemplateEntry[] {
  const std = structuredClone(DEFAULT_TEMPLATE);
  const measured = new Set(['measurement', 'test_equipment']);
  const checksOff = ONTOLOGY.classes.filter((c) => c.category === 'brakes').flatMap((c) => {
    const m = c.checks.filter((k) => measured.has(ONTOLOGY.checks[k].method));
    return m.length < c.checks.length ? m : [];
  });
  const courtesy: Template = { ...structuredClone(DEFAULT_TEMPLATE), id: 'courtesy-check', name: 'Courtesy check', checksOff };
  return [
    { id: DEMO_TEMPLATE_ID, family: 'std', version: 1, name: std.name, isDefault: true, data: std },
    { id: 't-courtesy-1', family: 'courtesy', version: 1, name: courtesy.name, isDefault: false, data: courtesy },
  ];
}

const NO_TEMPLATES: TemplateEntry[] = [];
const single = new WeakMap<object, TemplateEntry[]>();
/** The shop's templates, default first. (Stable between calls, so screens can select it from the store.) */
export function templateList(s: State): TemplateEntry[] {
  if (s.mode === 'demo') return s.demoTemplates;
  if (s.workspace?.templates?.length) return s.workspace.templates;
  const t = s.workspace?.template;
  if (!t) return NO_TEMPLATES;
  // An older server sends only the default template.
  if (!single.has(t)) single.set(t, [{ id: t.id, family: t.family ?? t.id, version: t.version, name: t.data.name, isDefault: true, data: t.data }]);
  return single.get(t)!;
}
/** The template an inspection uses (its own version when known, else the shop's default). */
export function templateOf(s: State, insp: Pick<Inspection, 'templateId'>): Template | null {
  return (insp.templateId ? s.templateDocs[insp.templateId] : undefined) ?? templateList(s).find((t) => t.isDefault)?.data ?? null;
}
/** Install an inspection's template before its screens work out points, parts and checks. */
export function activateTemplateFor(insp: Pick<Inspection, 'templateId'>) {
  const t = templateOf(state, insp);
  if (t) setTemplate(t);
}
/** Nothing has been recorded yet, so the inspection can still change template. */
export const templateSwitchable = (i: Inspection) => (i.status === 'not_started' || i.status === 'in_progress')
  && !i.results.length && !i.findings.length && !i.media.length && !i.statuses.length && !i.notes.length;
const localDay = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const todayIso = () => localDay();

/** Declined work as of today (demo: from this browser's inspections; live: from the last load). */
export function declinedItems(s: State, today = todayIso()): DeclinedItem[] {
  const src = s.mode === 'demo' ? { inspections: s.inspections, vehicles: s.vehicles } : s.declinedData;
  return src ? declinedWork(src.inspections, src.vehicles, s.followups, today) : [];
}
export function declinedVehicle(s: State, vehicleId: string): Vehicle | undefined {
  return (s.mode === 'live' ? s.declinedData?.vehicles : undefined)?.find((v) => v.id === vehicleId) ?? s.vehicles.find((v) => v.id === vehicleId);
}
function liveInitial(): State {
  return { ...demoInitial(), mode: 'live', vehicles: [], inspections: [], session: getSession() };
}

function load(): State {
  if (LIVE) return liveInitial();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const s = { ...demoInitial(), ...(JSON.parse(raw) as Partial<State>), loading: 0, busy: null, toast: null } as State;
      for (const i of s.inspections) for (const m of i.media) if (m.url.startsWith('blob:')) m.url = placeholderPhoto(m.label, 'photo from an earlier session');
      return s;
    }
  } catch { /* storage unavailable: fall back to seed */ }
  return demoInitial();
}

let state: State = load();
const listeners = new Set<() => void>();
function save() {
  if (state.mode !== 'demo') return;
  try {
    const { vehicles, inspections, demoNoteStyle, demoBaseline, demoTemplates, templateDocs, followups } = state;
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ vehicles, inspections, demoNoteStyle, demoBaseline, demoTemplates, templateDocs, followups }));
  } catch { /* ignore */ }
}
function set(patch: Partial<State>) { state = { ...state, ...patch }; save(); listeners.forEach((l) => l()); }

export function useStore<T>(select: (s: State) => T): T {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => select(state));
}
export const isLive = () => state.mode === 'live';

/** Photo address to show: demo photos are inline; live photos are signed, expiring storage links. */
export const photoSrc = (url: string) => (state.mode === 'demo' ? url : state.photoUrls[url] ?? '');

let toastTimer: ReturnType<typeof setTimeout> | undefined;
// An invite or pilot link survives the email-confirmation round trip (which lands back on the app's home).
export interface ChecksOff { platform: string[]; shop: string[]; admin: boolean }
export interface TechStats {
  userId: string; name: string; role: Role; inspections: number; last30: number; timed: number; avgSeconds: number | null; inProgress: number;
  recent: { id: string; ro: string; vehicle: string; startedAt: string | null; submittedAt: string; seconds: number | null }[];
}
/** A pilot application, as Wrynch staff see it. */
export interface PilotRequest {
  id: string; shopName: string; contactName: string; email: string; phone: string | null; location: string | null;
  techs: number | null; currentTool: string | null; notes: string | null; templatePoints: number | null;
  status: 'pending' | 'approved' | 'declined' | 'used'; createdAt: string; approvedAt: string | null; decidedAt: string | null;
  linkEmailedAt: string | null; adminNote: string | null; token: string | null; linkExpiresAt: string | null; usedAt: string | null;
  shop: { id: string; name: string; number: number } | null;
}
export interface PilotCounts { pending: number; approved: number; used: number; declined: number; total: number }
export interface AdminShop {
  id: string; name: string; number: number; createdAt: string; owner: string | null; members: number;
  inspections: number; last30: number; sent: number; lastActivity: string | null;
}
export interface TrainingItem { mediaId: string; url: string | null; shop: number; vehicle: string; stage: string; parts: string[] }
export interface TrainingStats { approved: number; skipped: number; waiting: number; shops: number; classes: Record<string, number> }
export interface ShopAiInfo { configured: boolean; provider?: 'anthropic' | 'openai'; model?: string | null; last4?: string | null; updatedAt?: string | null }
export interface TekmetricEvent { at: string; kind: 'import' | 'export' | 'webhook'; roId: number | null; inspectionId: string | null; status: 'ok' | 'error' | 'skipped'; detail: string }
export interface TekmetricLink { linked: boolean; tekmetricShopId: number | null; enabled: boolean; webhookToken: string | null; events: TekmetricEvent[] }
export interface TekmetricExportResult { written: boolean; reason?: string; text: string }
export interface PendingLink { kind: 'join' | 'pilot'; token: string }
const PENDING_KEY = 'wrynch-pending-link';
export function getPendingLink(): PendingLink | null {
  try { return JSON.parse(shared.get(PENDING_KEY) ?? 'null'); } catch { return null; }
}
export function setPendingLink(l: PendingLink | null) {
  shared.set(PENDING_KEY, l ? JSON.stringify(l) : null);
}

export function toast(text: string, kind: 'error' | 'info' = 'info') {
  clearTimeout(toastTimer);
  set({ toast: { text, kind } });
  toastTimer = setTimeout(() => set({ toast: null }), kind === 'error' ? 7000 : 3500);
}
const errText = (e: unknown) => (e instanceof ApiError || e instanceof Error ? e.message : 'Something went wrong');

/** Apply a change to one inspection in memory (copy-on-write). */
function edit(inspId: string, fn_: (i: Inspection, v: Vehicle) => void) {
  const inspections = state.inspections.map((i) => {
    if (i.id !== inspId) return i;
    const copy = structuredClone(i);
    fn_(copy, state.vehicles.find((v) => v.id === copy.vehicleId)!);
    return copy;
  });
  set({ inspections });
}

async function withLoading<T>(p: () => Promise<T>): Promise<T> {
  set({ loading: state.loading + 1 });
  try { return await p(); } finally { set({ loading: Math.max(0, state.loading - 1) }); }
}

interface Bundle { inspection: Inspection; vehicle: Vehicle; template: Template }
const queues = new Map<string, { tail: Promise<void>; waiting: number }>();
function mergeBundle(b: Bundle) {
  b.inspection.estimate ??= [];
  b.inspection.observations ??= [];
  const inspections = [...state.inspections.filter((i) => i.id !== b.inspection.id), b.inspection];
  const vehicles = [...state.vehicles.filter((v) => v.id !== b.vehicle.id), b.vehicle];
  if (b.template) setTemplate(b.template);
  const templateDocs = b.template && b.inspection.templateId ? { ...state.templateDocs, [b.inspection.templateId]: b.template } : state.templateDocs;
  set({ inspections, vehicles, templateDocs });
  void signMissing(b.inspection.media.map((m) => m.url));
}
async function signMissing(paths: string[]) {
  const missing = paths.filter((p) => !state.photoUrls[p]);
  if (!missing.length) return;
  try { set({ photoUrls: { ...state.photoUrls, ...(await signPhotos(missing)) } }); } catch { /* photos show blank; retry on next load */ }
}

async function reload(inspId: string) {
  const b = await rpc<Bundle>('get_inspection', { p_id: inspId });
  // A change tapped while this was loading is still on its way to the server; its own refresh will follow.
  if ((queues.get(inspId)?.waiting ?? 0) > 0) return;
  mergeBundle(b);
}

/**
 * Live change: show it now (optional), run it on the server, then reload the inspection.
 * If the server refuses, the reload puts the screen back to the truth and a message explains why.
 */
// Server calls for one inspection run one at a time, in the order the technician tapped, and the screen
// is refreshed from the server only once none are waiting — so a quick series of taps can't undo itself.
function liveEdit(inspId: string, optimistic: ((i: Inspection, v: Vehicle) => void) | null, remote: () => Promise<unknown>): Promise<void> {
  if (optimistic) edit(inspId, optimistic);
  const q = queues.get(inspId) ?? { tail: Promise.resolve(), waiting: 0 };
  queues.set(inspId, q);
  q.waiting++;
  q.tail = q.tail.then(async () => {
    try { await remote(); } catch (e) { toast(errText(e), 'error'); }
    q.waiting--;
    if (q.waiting === 0) { try { await reload(inspId); } catch (e) { toast(errText(e), 'error'); } }
  });
  return q.tail;
}

// ------------------------------------------------------------------ local implementations (demo + optimistic)
const local = {
  setOdometer: (odometer: number) => (i: Inspection) => { i.odometer = odometer; },
  confirmPlacements: (sectionId: string) => (i: Inspection) => {
    for (const m of i.media) if (m.sectionId === sectionId && !m.excluded) for (const l of m.links) if (l.status === 'ai_proposed') l.status = 'confirmed';
  },
  /** The technician sets the full list of parts a photo shows (mirrors set_photo_parts on the server). */
  setPhotoParts: (mediaId: string, keys: CompKey[]) => (i: Inspection) => {
    const m = i.media.find((x) => x.id === mediaId)!;
    const kept = m.links.filter((l) => keys.includes(l.compKey)).map((l) => (l.status === 'ai_proposed' ? { ...l, status: 'confirmed' as const } : l));
    for (const k of keys) if (!kept.some((l) => l.compKey === k)) kept.push({ compKey: k, status: 'technician_added', confidence: null });
    m.links = kept;
    m.excluded = false;
    for (const f of i.findings) if (f.mediaId === mediaId && f.status === 'pending' && !keys.includes(f.compKey)) { f.status = 'denied'; f.reviewedAt = now(); }
    for (const o of i.observations) if (o.mediaId === mediaId && o.status === 'pending' && !keys.includes(o.compKey)) o.status = 'rejected';
  },
  excludePhoto: (mediaId: string) => (i: Inspection) => {
    i.media.find((x) => x.id === mediaId)!.excluded = true;
    for (const f of i.findings) if (f.mediaId === mediaId && f.status === 'pending') { f.status = 'denied'; f.reviewedAt = now(); }
    for (const o of i.observations) if (o.mediaId === mediaId && o.status === 'pending') o.status = 'rejected';
  },
  reviewObservations: (action: 'confirm' | 'reject', items: { id: string; check: string }[]) => (i: Inspection) => {
    for (const it of items) {
      const o = i.observations.find((x) => x.id === it.id && x.status === 'pending');
      if (!o) continue;
      o.status = action === 'confirm' ? 'confirmed' : 'rejected';
      if (action === 'confirm' && !i.results.some((r) => r.compKey === o.compKey)
          && !i.findings.some((f) => f.compKey === o.compKey && f.status !== 'denied') && !i.statuses.some((x) => x.compKey === o.compKey)) {
        i.results.push({ compKey: o.compKey, checkKey: it.check, value: null, rating: 'ok', at: now() });
      }
    }
  },
  setPhotoVisible: (mediaId: string, visible: boolean) => (i: Inspection) => { i.media.find((x) => x.id === mediaId)!.customerVisible = visible; },
  setCheck: (key: CompKey, checkKey: string, value: number | null, picked: Rating | null) => (i: Inspection) => {
    const rating = value !== null ? rateValue(ONTOLOGY.checks[checkKey], value) ?? picked : picked;
    i.results = i.results.filter((r) => !(r.compKey === key && r.checkKey === checkKey));
    if (rating) i.results.push({ compKey: key, checkKey, value, rating, at: now() });
    if (rating !== 'monitor' && rating !== 'immediate') dropCheckFindings(i, key, checkKey);
    i.statuses = i.statuses.filter((s) => !(s.compKey === key && s.notInspected));
  },
  clearCheck: (key: CompKey, checkKey: string) => (i: Inspection) => {
    i.results = i.results.filter((r) => !(r.compKey === key && r.checkKey === checkKey));
    dropCheckFindings(i, key, checkKey);
  },
  /** The findings that explain a check's Monitor or Immediate rating (replaces the technician's earlier picks). */
  setCheckFindings: (key: CompKey, checkKey: string, findingKeys: string[]) => (i: Inspection) => {
    const r = i.results.find((x) => x.compKey === key && x.checkKey === checkKey);
    if (!r || r.rating === 'ok') return;
    i.findings = i.findings.filter((f) => !(f.compKey === key && f.checkKey === checkKey && f.source === 'technician'));
    for (const k of [...new Set(findingKeys)]) {
      i.findings.push({ id: uid('f'), compKey: key, checkKey, key: k, severity: r.rating === 'immediate' ? 'severe' : 'moderate', source: 'technician',
        status: 'confirmed', confidence: null, rationale: null, mediaId: null, reviewedAt: now(), aiOriginal: null });
    }
  },
  addFinding: (key: CompKey, findingKey: string, severity: Severity) => (i: Inspection) => {
    i.findings.push({ id: uid('f'), compKey: key, key: findingKey, severity, source: 'technician', status: 'confirmed',
      confidence: null, rationale: null, mediaId: null, reviewedAt: now(), aiOriginal: null });
    i.statuses = i.statuses.filter((s) => !(s.compKey === key && s.notInspected));
  },
  removeFinding: (findingId: string) => (i: Inspection) => { i.findings = i.findings.filter((f) => !(f.id === findingId && f.source === 'technician')); },
  reviewFinding: (findingId: string, action: 'confirm' | 'reject' | { key: string; severity: Severity }) => (i: Inspection) => {
    const f = i.findings.find((x) => x.id === findingId)!;
    f.reviewedAt = now();
    if (action === 'confirm') f.status = 'confirmed';
    else if (action === 'reject') f.status = 'denied';
    else { f.status = 'modified'; f.key = action.key; f.severity = action.severity; }
    if (f.status !== 'denied') fileAiFinding(i, f);
  },
  setNotInspected: (key: CompKey, kind: 'not_inspected' | 'unable_to_assess' | null, reason: NotInspectedReason | null) => (i: Inspection) => {
    i.statuses = i.statuses.filter((s) => s.compKey !== key);
    if (kind && reason) {
      i.statuses.push({ compKey: key, notInspected: { kind, reason }, override: null });
      for (const r of i.results.filter((x) => x.compKey === key)) dropCheckFindings(i, key, r.checkKey);
      i.results = i.results.filter((r) => r.compKey !== key);
    }
  },
  setNote: (pointId: string, text: string) => (i: Inspection) => {
    const n = i.notes.find((x) => x.pointId === pointId);
    if (n) { if (n.techText !== text) n.approved = false; n.techText = text; if (n.status === 'technician_original') n.customerText = text || null; }
    else i.notes.push({ pointId, techText: text, aiText: null, status: 'technician_original', customerText: text || null, approved: false });
  },
  /** The service advisor approves the note the customer reads for a point, as suggested or rewritten. */
  approveNote: (pointId: string, text: string) => (i: Inspection) => {
    const n = i.notes.find((x) => x.pointId === pointId);
    if (!n) { i.notes.push({ pointId, techText: '', aiText: null, status: 'technician_original', customerText: text, approved: true }); return; }
    if (n.status === 'ai_suggested') n.status = text === (n.aiText ?? '').trim() ? 'ai_accepted' : 'ai_edited';
    n.customerText = text;
    n.approved = true;
  },
};

/** A check rated OK, cleared or skipped keeps no findings (the database does the same). */
function dropCheckFindings(i: Inspection, key: CompKey, checkKey: string) {
  i.findings = i.findings.filter((f) => !(f.compKey === key && f.checkKey === checkKey && f.source === 'technician'));
  for (const f of i.findings) if (f.compKey === key && f.checkKey === checkKey && f.source === 'ai' && f.status !== 'pending') { f.status = 'denied'; f.reviewedAt = now(); }
}

/** A confirmed AI finding goes under the part's visual check, which takes the finding's rating if that's worse. */
function fileAiFinding(i: Inspection, f: Finding) {
  if (f.checkKey) return;
  const { classId } = parseKey(f.compKey);
  const check = aiFilingCheck(classId);
  const rating = findingRating(classId, f.key, f.severity);
  if (!check || rating === 'ok') return;
  f.checkKey = check;
  const r = i.results.find((x) => x.compKey === f.compKey && x.checkKey === check);
  if (r) { if (r.rating !== 'immediate') r.rating = rating; r.at = now(); }
  else i.results.push({ compKey: f.compKey, checkKey: check, value: null, rating, at: now() });
  i.statuses = i.statuses.filter((s) => !(s.compKey === f.compKey && s.notInspected));
}

/** Parts of a point that nobody has rated, flagged or skipped yet, with the check used for "nothing found". */
function untouched(i: Inspection, v: Vehicle, pointId: string) {
  return pointComponents(getPoint(pointId), v.config).filter((c) => c.applies
    && !i.results.some((r) => r.compKey === c.key) && !i.findings.some((f) => f.compKey === c.key && f.status !== 'denied')
    && !i.statuses.some((s) => s.compKey === c.key))
    .map((c) => ({ key: c.key, check: quickCheck(parseKey(c.key).classId) }));
}

export function placeholderPhoto(label: string, sub = 'sample photo'): string {
  const esc = (s: string) => s.replace(/[<>&"]/g, '');
  const h = [...label].reduce((a, c) => a + c.charCodeAt(0), 0);
  const shade = 38 + (h % 18);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480"><rect width="640" height="480" fill="rgb(${shade},${shade + 3},${shade + 8})"/><circle cx="320" cy="220" r="${90 + (h % 40)}" fill="none" stroke="#6b7078" stroke-width="18"/><text x="24" y="440" font-family="monospace" font-size="26" fill="#c9cdd3">${esc(label)}</text><text x="24" y="470" font-family="monospace" font-size="18" fill="#8c9096">${esc(sub)}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export interface NewInspection {
  vin: string; year: number | null; make: string; model: string; trim: string; engine: string; config: VehicleConfig;
  customerName: string; customerPhone: string; customerEmail: string; ro: string; odometer: number | null; concerns: string[];
  /** The template's family (null = the shop's default). */
  templateFamily?: string | null;
}

// ------------------------------------------------------------------ actions
/**
 * Sort photos with the AI, one photo per request and a few at a time, so no request comes near the server's
 * time limit. Photos the AI couldn't read stay unsorted and can be retried; the first reason is shown.
 */
async function runAiSort(inspId: string, ids: string[], quiet = false) {
  let done = 0, failed = 0, reason = '';
  if (!quiet) set({ busy: `AI is reading photo 1 of ${ids.length}…` });
  await pool(ids, 3, async (id) => {
    try {
      const r = await fn<{ failed?: number; reason?: string }>('ai-sort', { inspectionId: inspId, mediaIds: [id] });
      if (r?.failed) { failed += r.failed; reason ||= r.reason ?? ''; }
    } catch (e) {
      failed++; reason ||= errText(e);
    }
    done++;
    if (!quiet) set({ busy: done < ids.length ? `AI is reading photo ${done + 1} of ${ids.length}…` : 'Saving…' });
  });
  if (failed) toast(`The AI couldn’t read ${failed} of ${ids.length} ${ids.length === 1 ? 'photo' : 'photos'}. ${reason.replace(/ Photos are saved;.*$/, '')} Use “Sort with AI” to retry or place them by hand.`, 'error');
}

async function pool<T>(items: T[], n: number, fn: (x: T) => Promise<void>) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (next < items.length) await fn(items[next++]); }));
}

/** The shop's style for automatic notes. */
export function noteStyle(): NoteStyle {
  return state.mode === 'demo' ? state.demoNoteStyle ?? 'customer' : state.workspace?.shop?.noteStyle ?? 'customer';
}

/** Demo stand-in for /api/ai-wording: reword the tech's note, or draft one from confirmed facts when it's blank. */
const demoWording = (pointId: string) => (i: Inspection) => {
  const n = i.notes.find((x) => x.pointId === pointId);
  if (n?.techText.trim()) {
    if (n.approved) return;
    const s = suggestWording(n);
    n.aiText = wordingKeepsFacts(n.techText, s) ? s : null;
    n.status = n.aiText ? 'ai_suggested' : 'technician_original';
    return;
  }
  const v = state.vehicles.find((x) => x.id === i.vehicleId)!;
  const text = draftNote(pointFacts(i, v, getPoint(pointId)), noteStyle());
  if (n) { if (n.approved) return; n.aiText = text; n.status = 'ai_suggested'; }
  else i.notes.push({ pointId, techText: '', aiText: text, status: 'ai_suggested', customerText: null, approved: false });
};

/** Live mode: AI can run when Wrynch has a key or the shop saved its own (unknown counts as available). */
export function aiAvailable(s: State): boolean {
  if (s.mode !== 'live') return true;
  return s.ai === null || s.ai.on || !!s.shopAi?.configured;
}

export const actions = {
  // ---- session & workspace (live)
  async signIn(email: string, password: string) { await auth.signIn(email, password); await actions.loadWorkspace(); },
  async signUp(email: string, password: string, name: string) {
    const signedIn = await auth.signUp(email, password, name);
    if (signedIn) await actions.loadWorkspace();
    return signedIn;
  },
  async signOut() { await auth.signOut(); set({ ...liveInitial(), session: null }); },
  resetPassword: (email: string) => auth.resetPassword(email),
  setPassword: (password: string) => auth.setPassword(password),

  async loadWorkspace(shopId?: string) {
    if (state.mode !== 'live' || !getSession()) return;
    // Shop numbers give each shop its own address (1001.wrynch.app). On a shop's address, open that shop.
    const list = await rpc<{ id: string; name: string; number: number; role: Role; noteStyle?: NoteStyle }[]>('my_shop_list').catch(() => []);
    const host = hostInfo();
    const fromAddress = host.shopNumber !== null ? list.find((x) => x.number === host.shopNumber)?.id : undefined;
    const ws = await withLoading(() => rpc<Workspace & { jobs?: JobHeader[] }>('get_workspace', { p_shop: shopId ?? fromAddress ?? state.workspace?.shop?.id ?? null, p_days: 14 }));
    const num = (id?: string) => list.find((x) => x.id === id)?.number;
    const full: Workspace = {
      shops: (ws.shops ?? []).map((x) => ({ ...x, number: num(x.id) })), shop: ws.shop ? { ...ws.shop, number: num(ws.shop.id), noteStyle: list.find((x) => x.id === ws.shop!.id)?.noteStyle ?? 'customer' } : null,
      role: ws.role ?? null, me: ws.me ?? null, members: ws.members ?? [],
      invites: ws.invites ?? [], template: ws.template ?? null, templates: ws.templates ?? [], rules: ws.rules ?? null,
    };
    setTemplate(full.template?.data ?? structuredClone(DEFAULT_TEMPLATE));
    setThresholds(full.rules?.thresholds ?? []);
    set({ workspace: full, jobs: ws.jobs ?? [], session: getSession() });
    if (!state.ai) void actions.checkAi();
    void actions.loadShopAi();
    void actions.loadTrainingInfo();
    void actions.loadChecksOff();
    if (full.role === 'owner' || full.role === 'advisor') void actions.loadDeclined();
  },
  async loadDashboard(days: number) {
    if (state.mode === 'demo') { set({ dashboard: { ...dashFromInspections(state.inspections, state.vehicles, true, (i) => templateOf(state, i)), days, baseline: state.demoBaseline ?? null } }); return; }
    const shop = state.workspace?.shop?.id;
    if (!shop) return;
    try {
      const d = await rpc<DashData>('shop_dashboard', { p_shop: shop, p_days: days });
      set({ dashboard: { days: d.days, money: !!d.money, rows: d.rows ?? [], events: d.events ?? [], baseline: d.baseline ?? null } });
    } catch (e) { toast(errText(e), 'error'); }
  },
  /** Owner: the share of recommended work customers approved before Wrynch, in percent (null clears it). */
  async setApprovalBaseline(percent: number | null) {
    if (state.mode === 'demo') { set({ demoBaseline: percent, dashboard: state.dashboard ? { ...state.dashboard, baseline: percent } : null }); return; }
    try {
      await rpc('set_approval_baseline', { p_shop: state.workspace!.shop!.id, p_percent: percent });
      set({ dashboard: state.dashboard ? { ...state.dashboard, baseline: percent } : null });
    } catch (e) { toast(errText(e), 'error'); }
  },
  /** Inspection counts and times per technician (technicians only ever get their own). */
  techStats: (userId?: string) => rpc<TechStats[]>('technician_stats', { p_shop: state.workspace!.shop!.id, p_user: userId ?? null }),
  // ---- component checks (owners turn checks off for the shop; Wrynch staff for every shop)
  async loadChecksOff() {
    if (state.mode !== 'live' || !state.workspace?.shop) return;
    try {
      const raw = await rpc<ChecksOff>('disabled_checks', { p_shop: state.workspace.shop.id });
      // Checks retired from the catalog are kept off on the server; they aren't shown or counted here.
      const known = (keys: string[]) => keys.filter((k) => k in ONTOLOGY.checks);
      const c = { ...raw, platform: known(raw.platform), shop: known(raw.shop) };
      setDisabledChecks(c.platform, c.shop); set({ checksOff: c });
    } catch { /* keep what we have: every check stays available */ }
  },
  /** Wrynch staff: turn a catalog check on or off for every shop. (A template's own checks are saved with the template.) */
  async setPlatformCheckEnabled(checkKey: string, on: boolean) {
    const before = state.checksOff;
    const list = new Set(before.platform);
    if (on) list.delete(checkKey); else list.add(checkKey);
    const next = { ...before, platform: [...list].sort() };
    setDisabledChecks(next.platform, next.shop); set({ checksOff: next }); // show it right away; undone below if saving fails
    if (state.mode === 'demo') return;
    try { await rpc('set_platform_check_enabled', { p_check: checkKey, p_enabled: on }); } catch (e) { setDisabledChecks(before.platform, before.shop); set({ checksOff: before }); toast(errText(e), 'error'); }
  },
  // ---- training data (owners share; Wrynch staff label)
  async loadTrainingInfo() {
    if (state.mode !== 'live' || !state.workspace?.shop) return;
    try { set({ training: await rpc<{ shared: boolean; admin: boolean }>('shop_training_info', { p_shop: state.workspace.shop.id }) }); } catch { set({ training: null }); }
  },
  async setShareTraining(on: boolean) {
    const admin = state.training?.admin ?? false;
    set({ training: { admin, shared: on } }); // show the change right away; undone below if saving fails
    try {
      await rpc('set_share_training', { p_shop: state.workspace!.shop!.id, p_on: on });
      toast(on ? 'Thanks. Confirmed photos from this shop can now help train Wrynch’s AI.' : 'This shop’s photos are no longer used for training.');
    } catch (e) { set({ training: { admin, shared: !on } }); toast(errText(e), 'error'); }
  },
  // ---- Wrynch staff (the database refuses everyone else)
  adminPilots: () => rpc<{ requests: PilotRequest[]; counts: PilotCounts }>('admin_pilot_requests', {}),
  adminSetPilotStatus: (id: string, status: 'pending' | 'approved' | 'declined') => rpc<PilotRequest>('admin_set_pilot_status', { p_id: id, p_status: status }),
  adminSetPilotNote: (id: string, note: string) => rpc<PilotRequest>('admin_set_pilot_note', { p_id: id, p_note: note }),
  /** Approve and email the shop its sign-up link (the link comes back either way, to copy if email isn't set up). */
  adminApproveAndEmail: (id: string) => fn<{ request: PilotRequest; link: string; email: { status: 'sent' | 'failed' | 'skipped'; detail: string } }>('admin-pilot-approve', { id }),
  adminShops: () => rpc<AdminShop[]>('admin_shops', {}),
  trainingQueue: () => fn<{ items: TrainingItem[]; stats: TrainingStats }>('training', undefined, 'GET'),
  suggestBoxes: (mediaId: string) => fn<{ boxes: TrainingBox[]; note?: string }>('training-suggest', { mediaId }),
  saveTrainingLabel: (mediaId: string, status: 'approved' | 'skipped', boxes: TrainingBox[], width: number, height: number) =>
    rpc('training_save', { p_media: mediaId, p_status: status, p_boxes: boxes, p_width: width || null, p_height: height || null }),
  /** Download the dataset manifest (YOLO rows + photo links valid for 7 days). */
  async exportTrainingData(): Promise<number> {
    const m = await fn<{ createdAt: string; images: unknown[] }>('training-export', undefined, 'GET');
    const url = URL.createObjectURL(new Blob([JSON.stringify(m)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url; a.download = `wrynch-dataset-${m.createdAt.slice(0, 10)}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    return m.images.length;
  },
  async loadShopAi() {
    if (state.mode !== 'live' || !state.workspace?.shop) return;
    try { set({ shopAi: await rpc<ShopAiInfo>('shop_ai_key_info', { p_shop: state.workspace.shop.id }) }); } catch { set({ shopAi: null }); }
  },
  /** Owner: save the shop's own AI key. It's checked with the provider and encrypted on the server; it never comes back. */
  async saveShopAi(provider: 'anthropic' | 'openai', apiKey: string, model: string) {
    const info = await fn<ShopAiInfo>('ai-key', { shopId: state.workspace!.shop!.id, provider, apiKey, model });
    set({ shopAi: info });
    toast(`Saved. Wrynch now uses your ${provider === 'openai' ? 'OpenAI' : 'Anthropic'} account for this shop.`);
  },
  async removeShopAi() {
    await fn('ai-key', { shopId: state.workspace!.shop!.id }, 'DELETE');
    set({ shopAi: { configured: false } });
    toast('Your AI key was removed. Wrynch’s AI is used again (if it’s set up).');
  },
  async checkAi() {
    try {
      const r = await fn<{ ai: boolean; model: string; tekmetric?: boolean }>('status', undefined, 'GET', false);
      const x = r as { tekmetric?: boolean; shopKeys?: boolean };
      set({ ai: { on: !!r.ai, model: String(r.model ?? ''), tekmetric: !!x.tekmetric, shopKeys: !!x.shopKeys } });
    } catch { /* unknown: sorting is still attempted and reports its own error */ }
  },
  /** Ask the AI to sort photos that haven't been analysed yet (after a failure, or photos added while AI was off). */
  async sortWithAi(inspId: string, sectionId: string) {
    const i = state.inspections.find((x) => x.id === inspId);
    if (!i || state.mode !== 'live') return;
    const ids = i.media.filter((m) => m.sectionId === sectionId && !m.excluded && !m.analyzed && m.links.length === 0).map((m) => m.id);
    if (!ids.length) return;
    try {
      await runAiSort(inspId, ids);
    } catch (e) {
      toast(errText(e), 'error');
    } finally {
      set({ busy: null });
      await reload(inspId).catch(() => undefined);
    }
  },
  async createShop(name: string, displayName: string, pilotToken?: string) {
    const id = await rpc<string>('create_shop', { p_name: name, p_display_name: displayName, p_template: DEFAULT_TEMPLATE, p_pilot_token: pilotToken ?? null });
    setPendingLink(null);
    await actions.loadWorkspace(id);
  },
  async acceptInvite(token: string, displayName: string) {
    const id = await rpc<string>('accept_invite', { p_token: token, p_display_name: displayName });
    setPendingLink(null);
    await actions.loadWorkspace(id);
  },
  /** An approved pilot link: who it's for, or null if it's no longer valid. */
  pilotInvite: (token: string) => rpcAnon<{ shopName: string; contactName: string; email: string } | null>('pilot_invite', { p_token: token }),
  async invite(email: string, role: Role): Promise<string> {
    const token = await rpc<string>('invite_member', { p_shop: state.workspace!.shop!.id, p_email: email, p_role: role });
    await actions.loadWorkspace();
    return token;
  },
  async setMemberRole(userId: string, role: Role | null) {
    try { await rpc('set_member_role', { p_shop: state.workspace!.shop!.id, p_user: userId, p_role: role }); } catch (e) { toast(errText(e), 'error'); }
    await actions.loadWorkspace();
  },
  /**
   * Save a template: a new version of `family`, or a new template when `family` is null (undefined = the default).
   * Inspections already started keep the version they began with. Returns the template's family.
   */
  async saveTemplate(t: Template, family?: string | null): Promise<string> {
    const name = t.name.trim();
    if (!name) throw new Error('Give the template a name');
    const bare = partsLeftWithoutChecks(t.checksOff ?? []).map((id) => cls(id).label);
    if (bare.length) throw new Error(`Each part needs at least one check that is on: ${bare.join(', ')}`);
    const list = templateList(state);
    const fam = family === undefined ? list.find((x) => x.isDefault)?.family ?? null : family;
    if (list.some((x) => x.family !== fam && x.name.trim().toLowerCase() === name.toLowerCase())) throw new Error(`You already have a template called ${name}`);
    const data = { ...t, name };
    if (state.mode === 'demo') {
      const f = fam ?? uid('fam');
      const prev = list.find((x) => x.family === f);
      const version = (prev?.version ?? 0) + 1;
      const entry: TemplateEntry = { id: `t-${f}-${version}`, family: f, version, name, isDefault: prev?.isDefault ?? false, data };
      const demoTemplates = [...list.filter((x) => x.family !== f), entry].sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.name.localeCompare(b.name));
      set({ demoTemplates, templateDocs: { ...state.templateDocs, [entry.id]: data } });
      if (entry.isDefault) setTemplate(data);
      toast(prev ? `Saved “${name}” (version ${version}) in this browser (demo)` : `Created “${name}” in this browser (demo)`);
      return f;
    }
    const r = await rpc<{ id: string; family: string; version: number }>('save_template', { p_shop: state.workspace!.shop!.id, p_family: fam, p_template: data });
    await actions.loadWorkspace();
    toast(r.version > 1 ? `Saved “${name}” as version ${r.version}. New inspections on it use this version.` : `Created “${name}”.`);
    return r.family;
  },
  async setDefaultTemplate(family: string) {
    if (state.mode === 'demo') {
      const demoTemplates = state.demoTemplates.map((x) => ({ ...x, isDefault: x.family === family }))
        .sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.name.localeCompare(b.name));
      set({ demoTemplates });
    } else {
      try { await rpc('set_default_template', { p_shop: state.workspace!.shop!.id, p_family: family }); } catch (e) { toast(errText(e), 'error'); return; }
      await actions.loadWorkspace();
    }
    toast(`“${templateList(state).find((x) => x.family === family)?.name}” is now the default for new inspections.`);
  },
  /** Retire a template: new inspections can't use it; inspections that used it keep it. */
  async archiveTemplate(family: string) {
    const t = templateList(state).find((x) => x.family === family);
    if (!t) return;
    if (t.isDefault) { toast('Choose another default template before removing this one.', 'error'); return; }
    if (state.mode === 'demo') set({ demoTemplates: state.demoTemplates.filter((x) => x.family !== family) });
    else {
      try { await rpc('archive_template', { p_shop: state.workspace!.shop!.id, p_family: family }); } catch (e) { toast(errText(e), 'error'); return; }
      await actions.loadWorkspace();
    }
    toast(`Removed “${t.name}”. Inspections that used it keep it.`);
  },
  /** Switch an inspection to another template (only while nothing has been recorded on it). */
  async setInspectionTemplate(inspId: string, family: string) {
    const i = state.inspections.find((x) => x.id === inspId);
    const t = templateList(state).find((x) => x.family === family);
    if (!i || !t) return;
    if (!templateSwitchable(i)) { toast('Work has already been recorded on this inspection, so its template can’t change.', 'error'); return; }
    if (state.mode === 'demo') { edit(inspId, (x) => { x.templateId = t.id; }); return; }
    await liveEdit(inspId, (x) => { x.templateId = t.id; }, () => rpc('set_inspection_template', { p_inspection: inspId, p_family: family }));
  },
  async saveThresholds(list: Threshold[]) {
    if (state.mode === 'demo') { setThresholds(list); set({}); toast('Rating rules saved in this browser (demo)'); return; }
    await rpc('save_thresholds', { p_shop: state.workspace!.shop!.id, p_thresholds: list });
    await actions.loadWorkspace();
    toast(`Rating rules saved as version ${state.workspace?.rules?.number}. New inspections use them.`);
  },

  async createInspection(f: NewInspection): Promise<string> {
    if (state.mode === 'demo') {
      const vid = uid('v');
      const vehicle: Vehicle = { id: vid, vin: f.vin, year: f.year ?? 0, make: f.make, model: f.model, trim: f.trim, engine: f.engine,
        customer: f.customerName, customerPhone: f.customerPhone, customerEmail: f.customerEmail, config: f.config };
      const id = uid('i');
      const list = templateList(state);
      const template = list.find((x) => x.family === f.templateFamily) ?? list.find((x) => x.isDefault);
      const insp: Inspection = { id, ro: f.ro, vehicleId: vid, odometer: f.odometer ?? 0, date: new Date().toISOString().slice(0, 10), technician: 'You',
        status: 'not_started', concerns: f.concerns, dtcs: [], results: [], findings: [], media: [], statuses: [], notes: [], extraComponents: [],
        customerApprovals: [], estimate: [], observations: [], templateId: template?.id ?? DEMO_TEMPLATE_ID };
      set({ vehicles: [...state.vehicles, vehicle], inspections: [...state.inspections, insp] });
      return id;
    }
    const id = await rpc<string>('create_inspection', {
      p_shop: state.workspace!.shop!.id, p_vin: f.vin, p_year: f.year, p_make: f.make, p_model: f.model, p_trim: f.trim, p_engine: f.engine,
      p_config: f.config, p_customer_name: f.customerName, p_customer_phone: f.customerPhone, p_customer_email: f.customerEmail,
      p_ro: f.ro, p_odometer: f.odometer, p_concerns: f.concerns, p_template: f.templateFamily ?? null,
    });
    await Promise.all([reload(id), actions.loadWorkspace()]);
    return id;
  },
  decodeVin: (vin: string) => fn<{ vin: string; year: number | null; make: string; model: string; trim: string; engine: string; config: VehicleConfig; fromVin: string[] }>(`vin?vin=${encodeURIComponent(vin)}`, undefined, 'GET'),

  async loadInspection(id: string) {
    if (state.mode !== 'live') return;
    try { await withLoading(() => reload(id)); } catch (e) { toast(errText(e), 'error'); }
  },
  async loadVehicleHistory(vehicleId: string) {
    if (state.mode !== 'live') return;
    try {
      const h = await withLoading(() => rpc<{ vehicle: Vehicle; inspections: Inspection[] }>('get_vehicle_history', { p_vehicle: vehicleId }));
      const ids = new Set(h.inspections.map((i) => i.id));
      for (const i of h.inspections) { i.estimate ??= []; i.observations ??= []; }
      set({
        inspections: [...state.inspections.filter((i) => !ids.has(i.id)), ...h.inspections],
        vehicles: [...state.vehicles.filter((v) => v.id !== vehicleId), h.vehicle],
      });
      void signMissing(h.inspections.flatMap((i) => i.media.map((m) => m.url)));
    } catch (e) { toast(errText(e), 'error'); }
  },

  // ---- vehicle & inspection basics
  reset() { try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ } setTemplate(structuredClone(DEFAULT_TEMPLATE)); setThresholds([]); setDisabledChecks([], []); set(demoInitial()); },
  setConfig(inspId: string, vehicleId: string, patch: Partial<VehicleConfig>) {
    const v = state.vehicles.find((x) => x.id === vehicleId)!;
    const config = { ...v.config, ...patch };
    set({ vehicles: state.vehicles.map((x) => (x.id === vehicleId ? { ...x, config } : x)) });
    if (state.mode === 'live') void liveEdit(inspId, null, () => rpc('set_vehicle_config', { p_inspection: inspId, p_config: config }));
  },
  setOdometer(inspId: string, odometer: number) {
    if (state.mode === 'demo') return edit(inspId, local.setOdometer(odometer));
    void liveEdit(inspId, local.setOdometer(odometer), () => rpc('set_odometer', { p_inspection: inspId, p_odometer: odometer }));
  },
  start(inspId: string) {
    if (state.mode === 'demo') return edit(inspId, (i) => { if (i.status === 'not_started') i.status = 'in_progress'; });
    void liveEdit(inspId, (i) => { if (i.status === 'not_started') i.status = 'in_progress'; }, () => rpc('start_inspection', { p_inspection: inspId }));
  },
  addDtc(inspId: string, code: string, description: string, key: CompKey | null) {
    const loc = (i: Inspection) => { i.dtcs.push({ code: code.toUpperCase(), description, compKey: key }); if (key && !i.extraComponents.includes(key)) i.extraComponents.push(key); };
    if (state.mode === 'demo') return edit(inspId, loc);
    void liveEdit(inspId, loc, () => rpc('add_dtc', { p_inspection: inspId, p_code: code, p_description: description, p_key: key }));
  },

  // ---- photos
  /** Demo: files carry inline urls. Live: files carry File objects that are shrunk, uploaded, then sorted by AI on the server. */
  /** `quiet`: the in-app camera keeps shooting while photos upload, so no busy banner over the viewfinder. */
  async addPhotos(inspId: string, sectionId: string, files: { url: string; name: string; file?: File }[], pointId?: string, corner?: Corner | null, quiet = false) {
    if (!files.length) return;
    if (state.mode === 'demo') {
      edit(inspId, (i, v) => {
        const withIds = files.map((f) => ({ ...f, id: uid('m') }));
        for (const f of withIds) i.media.push({ id: f.id, sectionId, url: f.url, label: f.name, excluded: false, customerVisible: true, analyzed: false, links: [], pointId: pointId ?? null, corner: corner ?? null });
        applyAnalysis(i, analyzePhotos(sectionId, withIds, v.config, undefined, pointId, corner));
        if (i.status === 'not_started') i.status = 'in_progress';
      });
      return;
    }
    const shopId = state.workspace!.shop!.id;
    const ids: string[] = [];
    try {
      for (let k = 0; k < files.length; k++) {
        if (!quiet) set({ busy: `Uploading photo ${k + 1} of ${files.length}…` });
        const f = files[k];
        const id = crypto.randomUUID();
        const path = `${shopId}/${inspId}/${id}.jpg`;
        const blob = f.file ? await shrinkPhoto(f.file) : await (await fetch(f.url)).blob();
        await upload(path, blob);
        set({ photoUrls: { ...state.photoUrls, [path]: f.url } });
        if (corner) await rpc('add_captured_media', { p_inspection: inspId, p_media: id, p_section: sectionId, p_point: pointId ?? null, p_corner: corner, p_path: path, p_label: f.name });
        else if (pointId) await rpc('add_point_media', { p_inspection: inspId, p_media: id, p_section: sectionId, p_point: pointId, p_path: path, p_label: f.name });
        else await rpc('add_media', { p_inspection: inspId, p_media: id, p_section: sectionId, p_path: path, p_label: f.name });
        ids.push(id);
      }
      if (!aiAvailable(state)) toast(`${ids.length} ${ids.length === 1 ? 'photo' : 'photos'} saved. AI sorting isn’t set up, so place them by hand.`);
      else await runAiSort(inspId, ids, quiet);
    } catch (e) {
      toast(`${errText(e)}${ids.length && !/saved/.test(errText(e)) ? ` (${ids.length} photos saved; place any unsorted ones by hand)` : ''}`, 'error');
    } finally {
      set({ busy: null });
      await reload(inspId).catch(() => undefined);
    }
  },
  confirmPlacements(inspId: string, sectionId: string) {
    if (state.mode === 'demo') return edit(inspId, local.confirmPlacements(sectionId));
    void liveEdit(inspId, local.confirmPlacements(sectionId), () => rpc('confirm_placements', { p_inspection: inspId, p_section: sectionId }));
  },
  setPhotoParts(inspId: string, mediaId: string, keys: CompKey[]) {
    if (state.mode === 'demo') return edit(inspId, local.setPhotoParts(mediaId, keys));
    void liveEdit(inspId, local.setPhotoParts(mediaId, keys), () => rpc('set_photo_parts', { p_media: mediaId, p_keys: keys }));
  },
  /** Confirm or reject AI "looks OK" suggestions. A confirmed one records OK on the part's visual check. */
  reviewObservations(inspId: string, action: 'confirm' | 'reject', ids: string[]) {
    const i = state.inspections.find((x) => x.id === inspId)!;
    const items = ids.map((id) => ({ id, check: quickCheck(parseKey(i.observations.find((o) => o.id === id)!.compKey).classId) }));
    if (state.mode === 'demo') return edit(inspId, local.reviewObservations(action, items));
    void liveEdit(inspId, local.reviewObservations(action, items), () => rpc('review_observations', { p_inspection: inspId, p_action: action, p_items: items }));
  },
  excludePhoto(inspId: string, mediaId: string) {
    if (state.mode === 'demo') return edit(inspId, local.excludePhoto(mediaId));
    void liveEdit(inspId, local.excludePhoto(mediaId), () => rpc('exclude_photo', { p_media: mediaId }));
  },
  setPhotoCustomerVisible(inspId: string, mediaId: string, visible: boolean) {
    if (state.mode === 'demo') return edit(inspId, local.setPhotoVisible(mediaId, visible));
    void liveEdit(inspId, local.setPhotoVisible(mediaId, visible), () => rpc('set_photo_visible', { p_media: mediaId, p_visible: visible }));
  },

  // ---- checks & findings
  setCheck(inspId: string, key: CompKey, checkKey: string, value: number | null, picked: Rating | null) {
    if (state.mode === 'demo') return edit(inspId, local.setCheck(key, checkKey, value, picked));
    void liveEdit(inspId, local.setCheck(key, checkKey, value, picked),
      () => rpc('set_check', { p_inspection: inspId, p_key: key, p_check: checkKey, p_value: value, p_rating: picked }));
  },
  clearCheck(inspId: string, key: CompKey, checkKey: string) {
    if (state.mode === 'demo') return edit(inspId, local.clearCheck(key, checkKey));
    void liveEdit(inspId, local.clearCheck(key, checkKey), () => rpc('clear_check', { p_inspection: inspId, p_key: key, p_check: checkKey }));
  },
  setCheckFindings(inspId: string, key: CompKey, checkKey: string, findingKeys: string[]) {
    if (state.mode === 'demo') return edit(inspId, local.setCheckFindings(key, checkKey, findingKeys));
    void liveEdit(inspId, local.setCheckFindings(key, checkKey, findingKeys),
      () => rpc('set_check_findings', { p_inspection: inspId, p_key: key, p_check: checkKey, p_findings: findingKeys }));
  },
  addFinding(inspId: string, key: CompKey, findingKey: string, severity: Severity) {
    if (state.mode === 'demo') return edit(inspId, local.addFinding(key, findingKey, severity));
    void liveEdit(inspId, local.addFinding(key, findingKey, severity),
      () => rpc('add_finding', { p_inspection: inspId, p_key: key, p_finding: findingKey, p_severity: severity }));
  },
  removeFinding(inspId: string, findingId: string) {
    if (state.mode === 'demo') return edit(inspId, local.removeFinding(findingId));
    void liveEdit(inspId, local.removeFinding(findingId), () => rpc('remove_finding', { p_finding: findingId }));
  },
  reviewFinding(inspId: string, findingId: string, action: 'confirm' | 'reject' | { key: string; severity: Severity }) {
    if (state.mode === 'demo') return edit(inspId, local.reviewFinding(findingId, action));
    const args = typeof action === 'string' ? { p_finding: findingId, p_action: action } : { p_finding: findingId, p_action: 'modify', p_key: action.key, p_severity: action.severity };
    void liveEdit(inspId, local.reviewFinding(findingId, action), () => rpc('review_finding', args));
  },
  setNotInspected(inspId: string, key: CompKey, kind: 'not_inspected' | 'unable_to_assess' | null, reason: NotInspectedReason | null) {
    if (state.mode === 'demo') return edit(inspId, local.setNotInspected(key, kind, reason));
    void liveEdit(inspId, local.setNotInspected(key, kind, reason), () => rpc('set_not_inspected', { p_inspection: inspId, p_key: key, p_kind: kind, p_reason: reason }));
  },
  markPointOk(inspId: string, pointId: string) {
    const i = state.inspections.find((x) => x.id === inspId)!;
    const v = state.vehicles.find((x) => x.id === i.vehicleId)!;
    const items = untouched(i, v, pointId);
    const loc = (x: Inspection) => { for (const it of items) x.results.push({ compKey: it.key, checkKey: it.check, value: null, rating: 'ok', at: now() }); };
    if (state.mode === 'demo') return edit(inspId, loc);
    void liveEdit(inspId, loc, () => rpc('mark_ok', { p_inspection: inspId, p_items: items }));
  },

  /** A spoken note as text (server speech-to-text, for phones without their own). */
  async transcribe(inspId: string, audio: Blob): Promise<string> {
    if (state.mode === 'demo') throw new Error('Voice notes on this phone need the connected app.');
    const r = await fnBlob<{ text: string }>(`transcribe?inspectionId=${encodeURIComponent(inspId)}`, audio);
    return r.text ?? '';
  },

  // ---- notes & AI wording
  setNote(inspId: string, pointId: string, text: string) {
    if (state.mode === 'demo') return edit(inspId, local.setNote(pointId, text));
    void liveEdit(inspId, local.setNote(pointId, text), () => rpc('set_note', { p_inspection: inspId, p_point: pointId, p_text: text }));
  },
  /**
   * Report notes for several points (reworded, or summarized where the note is blank), three at a time. Each one is
   * stored as a suggestion the service advisor approves. Returns how many couldn't be written.
   */
  async autoNotes(inspId: string, pointIds: string[], onProgress?: (done: number) => void): Promise<number> {
    let done = 0; let failed = 0;
    if (state.mode === 'demo') {
      edit(inspId, (i) => { for (const p of pointIds) demoWording(p)(i); });
      onProgress?.(pointIds.length);
      return 0;
    }
    await queues.get(inspId)?.tail.catch(() => undefined); // ratings and notes still on their way go first
    await pool(pointIds, 3, async (pointId) => {
      try { await fn('ai-wording', { inspectionId: inspId, pointId }); } catch { failed++; }
      onProgress?.(++done);
    });
    await reload(inspId).catch(() => undefined);
    return failed;
  },
  async setNoteStyle(style: NoteStyle) {
    if (state.mode === 'demo') { set({ demoNoteStyle: style }); return; }
    const ws = state.workspace!;
    const prev = ws.shop!.noteStyle;
    set({ workspace: { ...ws, shop: { ...ws.shop!, noteStyle: style } } });
    try { await rpc('set_note_style', { p_shop: ws.shop!.id, p_style: style }); toast(`Automatic notes are now ${style === 'customer' ? 'customer-friendly' : 'technical'}.`); } catch (e) {
      toast(errText(e), 'error');
      set({ workspace: { ...state.workspace!, shop: { ...state.workspace!.shop!, noteStyle: prev } } });
    }
  },
  /** The service advisor approves a point's report note (as suggested or rewritten). */
  approveNote(inspId: string, pointId: string, text: string) {
    const t = text.trim();
    if (!t) { toast('A report note can’t be blank', 'error'); return; }
    if (state.mode === 'demo') return edit(inspId, local.approveNote(pointId, t));
    void liveEdit(inspId, local.approveNote(pointId, t), () => rpc('approve_note', { p_inspection: inspId, p_point: pointId, p_text: t }));
  },

  // ---- Tekmetric
  async loadTekmetric() {
    if (state.mode !== 'live' || !state.workspace?.shop) return;
    try { set({ tekmetric: await rpc<TekmetricLink>('tekmetric_link_for', { p_shop: state.workspace.shop.id }) }); } catch { /* shown as not linked */ }
  },
  async saveTekmetric(tekmetricShopId: number | null, enabled: boolean) {
    const link = await rpc<TekmetricLink>('set_tekmetric_link', { p_shop: state.workspace!.shop!.id, p_tekmetric_shop_id: tekmetricShopId, p_enabled: enabled });
    set({ tekmetric: link });
    toast(tekmetricShopId ? 'Tekmetric connection saved.' : 'Tekmetric disconnected.');
  },
  /** Pull one Tekmetric repair order by number into a new (or the existing) Wrynch inspection. */
  async importTekmetricRo(roNumber: string): Promise<string> {
    const r = await fn<{ inspectionId: string }>('tekmetric-import', { shopId: state.workspace!.shop!.id, roNumber });
    await Promise.all([actions.loadWorkspace(), reload(r.inspectionId).catch(() => undefined), actions.loadTekmetric()]);
    return r.inspectionId;
  },
  tekmetricRoOf: (inspId: string) => rpc<{ roId: number | null; exportedAt: string | null } | null>('tekmetric_ro_of', { p_inspection: inspId }),
  exportTekmetric: (inspId: string) => fn<TekmetricExportResult>('tekmetric-export', { inspectionId: inspId }),

  // ---- lifecycle
  async submit(inspId: string): Promise<boolean> {
    const i = state.inspections.find((x) => x.id === inspId)!;
    const v = state.vehicles.find((x) => x.id === i.vehicleId)!;
    if (completionGate(i, v).length) return false;
    if (state.mode === 'demo') { edit(inspId, (x) => { x.status = 'submitted'; }); return true; }
    try {
      // The points on this vehicle: each needs an approved report note before the advisor can send.
      await rpc('submit_inspection', { p_inspection: inspId, p_summary: { ...summarize(i, v), points: inspectionSteps(v).map((x) => x.pointId) } });
      await Promise.all([reload(inspId), actions.loadWorkspace()]);
      return true;
    } catch (e) { toast(errText(e), 'error'); await reload(inspId).catch(() => undefined); return false; }
  },
  async reopen(inspId: string) {
    if (state.mode === 'demo') return edit(inspId, (x) => { x.status = 'in_progress'; });
    await liveEdit(inspId, null, () => rpc('reopen_inspection', { p_inspection: inspId }));
  },
  /** Returns the customer link. */
  async sendToCustomer(inspId: string, channel: 'sms' | 'email' | 'link', to?: string): Promise<string | null> {
    if (state.mode === 'demo') { edit(inspId, (i) => { if (i.status === 'submitted') i.status = 'sent'; }); return `#/report/${inspId}`; }
    try {
      const r = await fn<{ link: string; status: string; detail: string }>('send-report', { inspectionId: inspId, channel, to });
      if (r.status === 'skipped' && channel !== 'link') toast(`${r.detail}. Copy the link and send it yourself.`, 'info');
      else toast(channel === 'link' ? 'Link ready' : `Sent by ${channel === 'sms' ? 'text' : 'email'}`);
      await reload(inspId);
      return r.link;
    } catch (e) { toast(errText(e), 'error'); await reload(inspId).catch(() => undefined); return null; }
  },
  toggleApproval(inspId: string, key: CompKey) {
    edit(inspId, (i) => {
      i.customerApprovals = i.customerApprovals.includes(key) ? i.customerApprovals.filter((k) => k !== key) : [...i.customerApprovals, key];
    });
  },

  // ---- estimates (advisor)
  saveEstimateLine(inspId: string, line: Omit<EstimateLine, 'id'> & { id?: string }) {
    const loc = (i: Inspection) => {
      const idx = i.estimate.findIndex((x) => x.id === line.id);
      const next = { ...line, id: line.id ?? uid('e') } as EstimateLine;
      if (idx >= 0) i.estimate[idx] = next; else i.estimate.push(next);
    };
    if (state.mode === 'demo') return edit(inspId, loc);
    void liveEdit(inspId, loc, () => rpc('save_estimate_line', {
      p_inspection: inspId, p_line: line.id ?? null, p_key: line.compKey, p_description: line.description, p_parts: line.parts, p_labor: line.labor,
    }));
  },
  deleteEstimateLine(inspId: string, lineId: string) {
    const loc = (i: Inspection) => { i.estimate = i.estimate.filter((x) => x.id !== lineId); };
    if (state.mode === 'demo') return edit(inspId, loc);
    void liveEdit(inspId, loc, () => rpc('delete_estimate_line', { p_inspection: inspId, p_line: lineId }));
  },

  // ---- declined work (advisors and owners)
  async loadDeclined() {
    if (state.mode !== 'live' || !state.workspace?.shop) return;
    try {
      const d = await rpc<{ inspections: Inspection[]; vehicles: Vehicle[]; followups: Followup[] }>('declined_work', { p_shop: state.workspace!.shop!.id, p_days: 365 });
      for (const i of d.inspections) { i.estimate ??= []; i.observations ??= []; }
      set({ declinedData: { inspections: d.inspections ?? [], vehicles: d.vehicles ?? [] }, followups: d.followups ?? [] });
    } catch (e) { toast(errText(e), 'error'); }
  },
  /** Record what the shop did about a declined part: texted the customer, booked it, let it go, or reopened it. */
  async setFollowup(item: Pick<DeclinedItem, 'inspectionId' | 'compKey' | 'followup'>, status: FollowupStatus, dueOn: string | null = item.followup?.dueOn ?? null) {
    const before = state.followups;
    const prev = item.followup;
    const at = now();
    const next: Followup = {
      inspectionId: item.inspectionId, compKey: item.compKey, status, dueOn, note: prev?.note ?? null, updatedAt: at,
      contactedAt: status === 'contacted' ? at : prev?.contactedAt ?? null, contacts: (prev?.contacts ?? 0) + (status === 'contacted' ? 1 : 0),
    };
    const others = before.filter((f) => !(f.inspectionId === item.inspectionId && f.compKey === item.compKey));
    set({ followups: [...others, next] }); // show it right away; undone below if saving fails
    if (state.mode === 'demo') return;
    try {
      const saved = await rpc<Followup>('set_followup', { p_inspection: item.inspectionId, p_key: item.compKey, p_status: status, p_due: dueOn, p_note: next.note });
      set({ followups: [...state.followups.filter((f) => !(f.inspectionId === item.inspectionId && f.compKey === item.compKey)), saved] });
    } catch (e) { set({ followups: before }); toast(errText(e), 'error'); }
  },

  // ---- demo helpers
  demoFillUnderCar(inspId: string) { edit(inspId, (i, v) => applyUnderCarExample(i, v)); },
  samplePhotos(sectionId: string, count: number): { url: string; name: string }[] {
    return Array.from({ length: count }, (_, k) => {
      const name = `${sectionId.replace('_', '-')}-${String(k + 1).padStart(2, '0')}.jpg`;
      return { name, url: placeholderPhoto(name) };
    });
  },
};

/** Jobs for the lists: server headers when live, computed from local data in the demo. */
export function jobList(s: State): JobHeader[] {
  if (s.mode === 'live') return s.jobs;
  return s.inspections.map((i) => {
    const v = s.vehicles.find((x) => x.id === i.vehicleId)!;
    const t = templateOf(s, i);
    return withTemplate(t, () => ({
      id: i.id, ro: i.ro, status: i.status, date: i.date, odometer: i.odometer, technician: i.technician, concerns: i.concerns,
      summary: summarize(i, v), pendingAi: completionGate(i, v).filter((g) => g.kind !== 'required').length, vehicle: v,
      templateId: i.templateId ?? null, templateName: t?.name ?? null,
    }));
  });
}

// Keep the store's session in step with sign-in/out (including another tab or an expired token).
onSession((s) => { if (state.mode === 'live') set(s ? { session: s } : { ...liveInitial(), session: null }); });
if (state.mode === 'live') {
  const linkType = auth.consumeLinkTokens();
  if (linkType) set({ session: getSession() });
  if (getSession()) void actions.loadWorkspace().catch((e) => toast(errText(e), 'error'));
}
