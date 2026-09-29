// App state and every action the screens can take.
//
// Two modes share one set of actions:
//  * demo — no backend configured: seeded data kept in this browser.
//  * live — Supabase configured at build time: the change is shown immediately, sent to the database
//    function that enforces the rules, then the inspection is reloaded from the server (the source of truth).
import { useSyncExternalStore } from 'react';
import {
  DEFAULT_TEMPLATE, ONTOLOGY, parseKey, point as getPoint, pointComponents, setTemplate, setThresholds, type Threshold,
} from '../domain/ontology';
import { completionGate, rateValue, summarize, type Summary } from '../domain/rating';
import { applyUnderCarExample, quickCheck, seedInspections, VEHICLES } from '../domain/seed';
import { analyzePhotos, applyAnalysis, suggestWording, wordingKeepsFacts } from '../domain/aiStub';
import type {
  CompKey, EstimateLine, Inspection, NotInspectedReason, Rating, Severity, Template, Vehicle, VehicleConfig,
} from '../domain/types';
import { ApiError, auth, fn, getSession, LIVE, onSession, rpc, shrinkPhoto, signPhotos, upload, type Session } from './remote';

export type Role = 'owner' | 'advisor' | 'technician';
export interface Member { userId: string; name: string; role: Role }
export interface Workspace {
  shops: { id: string; name: string; role: Role }[];
  shop: { id: string; name: string; phone: string | null } | null;
  role: Role | null;
  me: { userId: string; name: string } | null;
  members: Member[];
  invites: { email: string; role: Role; token: string; createdAt: string }[];
  template: { id: string; version: number; data: Template } | null;
  rules: { id: string; number: number; thresholds: Threshold[] } | null;
}
export interface JobHeader {
  id: string; ro: string; status: Inspection['status']; date: string; odometer: number; technician: string;
  concerns: string[]; summary: Summary | null; pendingAi: number; vehicle: Vehicle;
}
export interface State {
  mode: 'demo' | 'live';
  vehicles: Vehicle[];
  inspections: Inspection[];
  role: 'tech' | 'advisor' | 'customer';   // demo view switcher
  session: Session | null;
  workspace: Workspace | null;
  jobs: JobHeader[];
  loading: number;
  busy: string | null;
  toast: { text: string; kind: 'error' | 'info' } | null;
  photoUrls: Record<string, string>;
  /** Live mode: whether real AI photo sorting is available (null until checked). */
  ai: { on: boolean; model: string } | null;
}

const STORAGE_KEY = 'wrynch-demo-v3'; // bumped when the saved demo data shape changes
const now = () => new Date().toISOString();
let seq = Date.now();
const uid = (p: string) => `${p}-${(seq++).toString(36)}`;

function demoInitial(): State {
  return {
    mode: 'demo', vehicles: structuredClone(VEHICLES), inspections: seedInspections(), role: 'tech',
    session: null, workspace: null, jobs: [], loading: 0, busy: null, toast: null, photoUrls: {}, ai: null,
  };
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
    const { vehicles, inspections, role } = state;
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ vehicles, inspections, role }));
  } catch { /* ignore */ }
}
function set(patch: Partial<State>) { state = { ...state, ...patch }; save(); listeners.forEach((l) => l()); }

export function useStore<T>(select: (s: State) => T): T {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => select(state));
}
export const getState = () => state;
export const isLive = () => state.mode === 'live';

/** Photo address to show: demo photos are inline; live photos are signed, expiring storage links. */
export const photoSrc = (url: string) => (state.mode === 'demo' ? url : state.photoUrls[url] ?? '');

let toastTimer: ReturnType<typeof setTimeout> | undefined;
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
  set({ inspections, vehicles });
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
    i.statuses = i.statuses.filter((s) => !(s.compKey === key && s.notInspected));
  },
  clearCheck: (key: CompKey, checkKey: string) => (i: Inspection) => { i.results = i.results.filter((r) => !(r.compKey === key && r.checkKey === checkKey)); },
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
  },
  setNotInspected: (key: CompKey, kind: 'not_inspected' | 'unable_to_assess' | null, reason: NotInspectedReason | null) => (i: Inspection) => {
    i.statuses = i.statuses.filter((s) => s.compKey !== key);
    if (kind && reason) { i.statuses.push({ compKey: key, notInspected: { kind, reason }, override: null }); i.results = i.results.filter((r) => r.compKey !== key); }
  },
  setNote: (pointId: string, text: string) => (i: Inspection) => {
    const n = i.notes.find((x) => x.pointId === pointId);
    if (n) { n.techText = text; if (n.status === 'technician_original') n.customerText = text || null; }
    else i.notes.push({ pointId, techText: text, aiText: null, status: 'technician_original', customerText: text || null });
  },
  resolveWording: (pointId: string, action: 'accept' | 'reject' | { text: string }) => (i: Inspection) => {
    const n = i.notes.find((x) => x.pointId === pointId)!;
    if (action === 'accept') { n.status = 'ai_accepted'; n.customerText = n.aiText; }
    else if (action === 'reject') { n.status = 'ai_rejected'; n.customerText = n.techText; }
    else { n.status = 'ai_edited'; n.customerText = action.text; }
  },
};

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
}

// ------------------------------------------------------------------ actions
/**
 * Sort photos with the AI, one photo per request and a few at a time, so no request comes near the server's
 * time limit. Photos the AI couldn't read stay unsorted and can be retried; the first reason is shown.
 */
async function runAiSort(inspId: string, ids: string[]) {
  let done = 0, failed = 0, reason = '';
  set({ busy: `AI is reading photo 1 of ${ids.length}…` });
  await pool(ids, 3, async (id) => {
    try {
      const r = await fn<{ failed?: number; reason?: string }>('ai-sort', { inspectionId: inspId, mediaIds: [id] });
      if (r?.failed) { failed += r.failed; reason ||= r.reason ?? ''; }
    } catch (e) {
      failed++; reason ||= errText(e);
    }
    done++;
    set({ busy: done < ids.length ? `AI is reading photo ${done + 1} of ${ids.length}…` : 'Saving…' });
  });
  if (failed) toast(`The AI couldn’t read ${failed} of ${ids.length} ${ids.length === 1 ? 'photo' : 'photos'}. ${reason.replace(/ Photos are saved;.*$/, '')} Use “Sort with AI” to retry or place them by hand.`, 'error');
}

async function pool<T>(items: T[], n: number, fn: (x: T) => Promise<void>) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (next < items.length) await fn(items[next++]); }));
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
    const ws = await withLoading(() => rpc<Workspace & { jobs?: JobHeader[] }>('get_workspace', { p_shop: shopId ?? state.workspace?.shop?.id ?? null, p_days: 14 }));
    const full: Workspace = {
      shops: ws.shops ?? [], shop: ws.shop ?? null, role: ws.role ?? null, me: ws.me ?? null, members: ws.members ?? [],
      invites: ws.invites ?? [], template: ws.template ?? null, rules: ws.rules ?? null,
    };
    setTemplate(full.template?.data ?? structuredClone(DEFAULT_TEMPLATE));
    setThresholds(full.rules?.thresholds ?? []);
    set({ workspace: full, jobs: ws.jobs ?? [], session: getSession() });
    if (!state.ai) void actions.checkAi();
  },
  async checkAi() {
    try {
      const r = await fn<{ ai: boolean; model: string }>('status', undefined, 'GET', false);
      set({ ai: { on: !!r.ai, model: String(r.model ?? '') } });
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
  async createShop(name: string, displayName: string) {
    const id = await rpc<string>('create_shop', { p_name: name, p_display_name: displayName, p_template: DEFAULT_TEMPLATE });
    await actions.loadWorkspace(id);
  },
  async acceptInvite(token: string, displayName: string) {
    const id = await rpc<string>('accept_invite', { p_token: token, p_display_name: displayName });
    await actions.loadWorkspace(id);
  },
  async invite(email: string, role: Role): Promise<string> {
    const token = await rpc<string>('invite_member', { p_shop: state.workspace!.shop!.id, p_email: email, p_role: role });
    await actions.loadWorkspace();
    return token;
  },
  async setMemberRole(userId: string, role: Role | null) {
    try { await rpc('set_member_role', { p_shop: state.workspace!.shop!.id, p_user: userId, p_role: role }); } catch (e) { toast(errText(e), 'error'); }
    await actions.loadWorkspace();
  },
  async saveTemplate(t: Template) {
    if (state.mode === 'demo') { setTemplate(t); set({}); toast('Template saved in this browser (demo)'); return; }
    await rpc('save_template', { p_shop: state.workspace!.shop!.id, p_template: t });
    await actions.loadWorkspace();
    toast(`Template saved as version ${state.workspace?.template?.version}. New inspections use it.`);
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
      const insp: Inspection = { id, ro: f.ro, vehicleId: vid, odometer: f.odometer ?? 0, date: new Date().toISOString().slice(0, 10), technician: 'You',
        status: 'not_started', concerns: f.concerns, dtcs: [], results: [], findings: [], media: [], statuses: [], notes: [], extraComponents: [],
        customerApprovals: [], estimate: [], observations: [] };
      set({ vehicles: [...state.vehicles, vehicle], inspections: [...state.inspections, insp] });
      return id;
    }
    const id = await rpc<string>('create_inspection', {
      p_shop: state.workspace!.shop!.id, p_vin: f.vin, p_year: f.year, p_make: f.make, p_model: f.model, p_trim: f.trim, p_engine: f.engine,
      p_config: f.config, p_customer_name: f.customerName, p_customer_phone: f.customerPhone, p_customer_email: f.customerEmail,
      p_ro: f.ro, p_odometer: f.odometer, p_concerns: f.concerns,
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
  setRole(role: State['role']) { set({ role }); },
  reset() { try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ } setTemplate(structuredClone(DEFAULT_TEMPLATE)); setThresholds([]); set(demoInitial()); },
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
  async addPhotos(inspId: string, sectionId: string, files: { url: string; name: string; file?: File }[]) {
    if (!files.length) return;
    if (state.mode === 'demo') {
      edit(inspId, (i, v) => {
        const withIds = files.map((f) => ({ ...f, id: uid('m') }));
        for (const f of withIds) i.media.push({ id: f.id, sectionId, url: f.url, label: f.name, excluded: false, customerVisible: true, analyzed: false, links: [] });
        applyAnalysis(i, analyzePhotos(sectionId, withIds, v.config));
        if (i.status === 'not_started') i.status = 'in_progress';
      });
      return;
    }
    const shopId = state.workspace!.shop!.id;
    const ids: string[] = [];
    try {
      for (let k = 0; k < files.length; k++) {
        set({ busy: `Uploading photo ${k + 1} of ${files.length}…` });
        const f = files[k];
        const id = crypto.randomUUID();
        const path = `${shopId}/${inspId}/${id}.jpg`;
        const blob = f.file ? await shrinkPhoto(f.file) : await (await fetch(f.url)).blob();
        await upload(path, blob);
        set({ photoUrls: { ...state.photoUrls, [path]: f.url } });
        await rpc('add_media', { p_inspection: inspId, p_media: id, p_section: sectionId, p_path: path, p_label: f.name });
        ids.push(id);
      }
      if (state.ai && !state.ai.on) toast(`${ids.length} ${ids.length === 1 ? 'photo' : 'photos'} saved. AI sorting isn’t set up, so place them by hand.`);
      else await runAiSort(inspId, ids);
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

  // ---- notes & AI wording
  setNote(inspId: string, pointId: string, text: string) {
    if (state.mode === 'demo') return edit(inspId, local.setNote(pointId, text));
    void liveEdit(inspId, local.setNote(pointId, text), () => rpc('set_note', { p_inspection: inspId, p_point: pointId, p_text: text }));
  },
  async requestWording(inspId: string, pointId: string) {
    if (state.mode === 'demo') {
      return edit(inspId, (i) => {
        const n = i.notes.find((x) => x.pointId === pointId);
        if (!n || !n.techText.trim()) return;
        const s = suggestWording(n);
        n.aiText = wordingKeepsFacts(n.techText, s) ? s : null;
        n.status = n.aiText ? 'ai_suggested' : 'technician_original';
      });
    }
    set({ busy: 'Writing a customer version…' });
    try { await fn('ai-wording', { inspectionId: inspId, pointId }); } catch (e) { toast(errText(e), 'error'); } finally { set({ busy: null }); }
    await reload(inspId).catch(() => undefined);
  },
  resolveWording(inspId: string, pointId: string, action: 'accept' | 'reject' | { text: string }) {
    if (state.mode === 'demo') return edit(inspId, local.resolveWording(pointId, action));
    const args = typeof action === 'string' ? { p_action: action } : { p_action: 'edit', p_text: action.text };
    void liveEdit(inspId, local.resolveWording(pointId, action), () => rpc('resolve_wording', { p_inspection: inspId, p_point: pointId, ...args }));
  },

  // ---- lifecycle
  async submit(inspId: string): Promise<boolean> {
    const i = state.inspections.find((x) => x.id === inspId)!;
    const v = state.vehicles.find((x) => x.id === i.vehicleId)!;
    if (completionGate(i, v).length) return false;
    if (state.mode === 'demo') { edit(inspId, (x) => { x.status = 'submitted'; }); return true; }
    try {
      await rpc('submit_inspection', { p_inspection: inspId, p_summary: summarize(i, v) });
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
    return {
      id: i.id, ro: i.ro, status: i.status, date: i.date, odometer: i.odometer, technician: i.technician, concerns: i.concerns,
      summary: summarize(i, v), pendingAi: completionGate(i, v).filter((g) => g.kind !== 'required').length, vehicle: v,
    };
  });
}

// Keep the store's session in step with sign-in/out (including another tab or an expired token).
onSession((s) => { if (state.mode === 'live') set(s ? { session: s } : { ...liveInitial(), session: null }); });
if (state.mode === 'live') {
  const linkType = auth.consumeLinkTokens();
  if (linkType) set({ session: getSession() });
  if (getSession()) void actions.loadWorkspace().catch((e) => toast(errText(e), 'error'));
}
