// App state: a small store with actions. Persisted to localStorage when available (demo only);
// the production app replaces this with the API described in db/schema.sql.
import { useSyncExternalStore } from 'react';
import { ONTOLOGY, parseKey, point as getPoint, pointComponents } from '../domain/ontology';
import { completionGate, rateValue } from '../domain/rating';
import { applyUnderCarExample, quickCheck, seedInspections, VEHICLES } from '../domain/seed';
import { sortPhotos, suggestWording, wordingKeepsFacts } from '../domain/aiStub';
import type {
  CompKey, Inspection, NotInspectedReason, Rating, Severity, Vehicle, VehicleConfig,
} from '../domain/types';

export interface State { vehicles: Vehicle[]; inspections: Inspection[]; role: 'tech' | 'advisor' | 'customer' }

const STORAGE_KEY = 'wrynch-demo-v1';
const now = () => new Date().toISOString();
let seq = Date.now();
const uid = (p: string) => `${p}-${(seq++).toString(36)}`;

function initial(): State {
  return { vehicles: structuredClone(VEHICLES), inspections: seedInspections(), role: 'tech' };
}

function load(): State {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const s = JSON.parse(raw) as State;
      // object URLs from an earlier page load are gone; show a placeholder instead
      for (const i of s.inspections) for (const m of i.media) if (m.url.startsWith('blob:')) m.url = placeholderPhoto(m.label, 'photo from an earlier session');
      return s;
    }
  } catch { /* storage unavailable: fall back to seed */ }
  return initial();
}

let state: State = load();
const listeners = new Set<() => void>();
function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* ignore */ }
}
function set(next: State) { state = next; save(); listeners.forEach((l) => l()); }

export function useStore<T>(select: (s: State) => T): T {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => select(state));
}
export const getState = () => state;

/** Apply a change to one inspection (copy-on-write). */
function edit(inspId: string, fn: (i: Inspection, v: Vehicle) => void) {
  const inspections = state.inspections.map((i) => {
    if (i.id !== inspId) return i;
    const copy = structuredClone(i);
    fn(copy, state.vehicles.find((v) => v.id === copy.vehicleId)!);
    return copy;
  });
  set({ ...state, inspections });
}

export function placeholderPhoto(label: string, sub = 'sample photo'): string {
  const esc = (s: string) => s.replace(/[<>&"]/g, '');
  const h = [...label].reduce((a, c) => a + c.charCodeAt(0), 0);
  const shade = 38 + (h % 18);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480"><rect width="640" height="480" fill="rgb(${shade},${shade + 3},${shade + 8})"/><circle cx="320" cy="220" r="${90 + (h % 40)}" fill="none" stroke="#6b7078" stroke-width="18"/><text x="24" y="440" font-family="monospace" font-size="26" fill="#c9cdd3">${esc(label)}</text><text x="24" y="470" font-family="monospace" font-size="18" fill="#8c9096">${esc(sub)}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export const actions = {
  setRole(role: State['role']) { set({ ...state, role }); },
  reset() { try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ } set(initial()); },

  setConfig(vehicleId: string, patch: Partial<VehicleConfig>) {
    set({ ...state, vehicles: state.vehicles.map((v) => (v.id === vehicleId ? { ...v, config: { ...v.config, ...patch } } : v)) });
  },
  setOdometer(inspId: string, odometer: number) { edit(inspId, (i) => { i.odometer = odometer; }); },
  start(inspId: string) { edit(inspId, (i) => { if (i.status === 'not_started') i.status = 'in_progress'; }); },

  // ---- photos
  addPhotos(inspId: string, sectionId: string, files: { url: string; name: string }[]) {
    edit(inspId, (i, v) => {
      const withIds = files.map((f) => ({ ...f, id: uid('m') }));
      const out = sortPhotos(sectionId, withIds, v.config, now());
      i.media.push(...out.media);
      i.findings.push(...out.findings);
      if (i.status === 'not_started') i.status = 'in_progress';
    });
  },
  confirmPlacements(inspId: string, sectionId: string) {
    edit(inspId, (i) => {
      for (const m of i.media) if (m.sectionId === sectionId && m.status === 'ai_proposed') {
        m.status = 'confirmed'; m.history.push({ at: now(), status: 'confirmed', compKey: m.compKey });
      }
    });
  },
  placePhoto(inspId: string, mediaId: string, pointId: string, key: CompKey) {
    edit(inspId, (i) => {
      const m = i.media.find((x) => x.id === mediaId)!;
      const same = m.aiGuess && m.aiGuess.compKey === key;
      m.status = !m.aiGuess ? 'technician_assigned' : same && m.status === 'ai_proposed' ? 'confirmed' : 'reassigned';
      m.pointId = pointId; m.compKey = key;
      m.history.push({ at: now(), status: m.status, compKey: key });
      // an AI finding raised from this photo follows the photo's part only if the tech keeps it on that part
      for (const f of i.findings) if (f.mediaId === mediaId && f.status === 'pending' && f.compKey !== key) {
        f.status = 'denied'; f.reviewedAt = now();
      }
    });
  },
  excludePhoto(inspId: string, mediaId: string) {
    edit(inspId, (i) => {
      const m = i.media.find((x) => x.id === mediaId)!;
      m.status = 'excluded'; m.history.push({ at: now(), status: 'excluded', compKey: m.compKey });
      for (const f of i.findings) if (f.mediaId === mediaId && f.status === 'pending') { f.status = 'denied'; f.reviewedAt = now(); }
    });
  },
  setPhotoCustomerVisible(inspId: string, mediaId: string, visible: boolean) {
    edit(inspId, (i) => { i.media.find((x) => x.id === mediaId)!.customerVisible = visible; });
  },

  // ---- checks & findings
  setCheck(inspId: string, key: CompKey, checkKey: string, value: number | null, picked: Rating | null) {
    edit(inspId, (i) => {
      const check = ONTOLOGY.checks[checkKey];
      const rating = value !== null ? rateValue(check, value) ?? picked : picked;
      i.results = i.results.filter((r) => !(r.compKey === key && r.checkKey === checkKey));
      if (rating) i.results.push({ compKey: key, checkKey, value, rating, at: now() });
      i.statuses = i.statuses.filter((s) => !(s.compKey === key && s.notInspected));
    });
  },
  clearCheck(inspId: string, key: CompKey, checkKey: string) {
    edit(inspId, (i) => { i.results = i.results.filter((r) => !(r.compKey === key && r.checkKey === checkKey)); });
  },
  addFinding(inspId: string, key: CompKey, findingKey: string, severity: Severity) {
    edit(inspId, (i) => {
      i.findings.push({ id: uid('f'), compKey: key, key: findingKey, severity, source: 'technician', status: 'confirmed',
        confidence: null, rationale: null, mediaId: null, reviewedAt: now(), aiOriginal: null });
      i.statuses = i.statuses.filter((s) => !(s.compKey === key && s.notInspected));
    });
  },
  removeFinding(inspId: string, findingId: string) {
    edit(inspId, (i) => { i.findings = i.findings.filter((f) => !(f.id === findingId && f.source === 'technician')); });
  },
  reviewFinding(inspId: string, findingId: string, action: 'confirm' | 'reject' | { key: string; severity: Severity }) {
    edit(inspId, (i) => {
      const f = i.findings.find((x) => x.id === findingId)!;
      f.reviewedAt = now();
      if (action === 'confirm') f.status = 'confirmed';
      else if (action === 'reject') f.status = 'denied';
      else { f.status = 'modified'; f.key = action.key; f.severity = action.severity; }
    });
  },
  setNotInspected(inspId: string, key: CompKey, kind: 'not_inspected' | 'unable_to_assess' | null, reason: NotInspectedReason | null) {
    edit(inspId, (i) => {
      i.statuses = i.statuses.filter((s) => s.compKey !== key);
      if (kind && reason) {
        i.statuses.push({ compKey: key, notInspected: { kind, reason }, override: null });
        i.results = i.results.filter((r) => r.compKey !== key);
      }
    });
  },
  /** "Nothing found" for every unrated component of a point. */
  markPointOk(inspId: string, pointId: string) {
    edit(inspId, (i, v) => {
      for (const c of pointComponents(getPoint(pointId), v.config)) {
        if (!c.applies) continue;
        const touched = i.results.some((r) => r.compKey === c.key) || i.findings.some((f) => f.compKey === c.key)
          || i.statuses.some((s) => s.compKey === c.key);
        if (!touched) i.results.push({ compKey: c.key, checkKey: quickCheck(parseKey(c.key).classId), value: null, rating: 'ok', at: now() });
      }
    });
  },

  // ---- notes & AI wording
  setNote(inspId: string, pointId: string, text: string) {
    edit(inspId, (i) => {
      const n = i.notes.find((x) => x.pointId === pointId);
      if (n) { n.techText = text; if (n.status === 'technician_original') n.customerText = text || null; }
      else i.notes.push({ pointId, techText: text, aiText: null, status: 'technician_original', customerText: text || null });
    });
  },
  requestWording(inspId: string, pointId: string) {
    edit(inspId, (i) => {
      const n = i.notes.find((x) => x.pointId === pointId);
      if (!n || !n.techText.trim()) return;
      const s = suggestWording(n);
      n.aiText = wordingKeepsFacts(n.techText, s) ? s : null;
      n.status = n.aiText ? 'ai_suggested' : 'technician_original';
    });
  },
  resolveWording(inspId: string, pointId: string, action: 'accept' | 'reject' | { text: string }) {
    edit(inspId, (i) => {
      const n = i.notes.find((x) => x.pointId === pointId)!;
      if (action === 'accept') { n.status = 'ai_accepted'; n.customerText = n.aiText; }
      else if (action === 'reject') { n.status = 'ai_rejected'; n.customerText = n.techText; }
      else { n.status = 'ai_edited'; n.customerText = action.text; }
    });
  },

  // ---- lifecycle
  submit(inspId: string): boolean {
    const i = state.inspections.find((x) => x.id === inspId)!;
    const v = state.vehicles.find((x) => x.id === i.vehicleId)!;
    if (completionGate(i, v).length) return false;
    edit(inspId, (x) => { x.status = 'submitted'; });
    return true;
  },
  sendToCustomer(inspId: string) { edit(inspId, (i) => { if (i.status === 'submitted') i.status = 'sent'; }); },
  toggleApproval(inspId: string, key: CompKey) {
    edit(inspId, (i) => {
      i.customerApprovals = i.customerApprovals.includes(key) ? i.customerApprovals.filter((k) => k !== key) : [...i.customerApprovals, key];
    });
  },
  demoFillUnderCar(inspId: string) { edit(inspId, (i, v) => applyUnderCarExample(i, v)); },
  samplePhotos(sectionId: string, count: number): { url: string; name: string }[] {
    return Array.from({ length: count }, (_, k) => {
      const name = `${sectionId.replace('_', '-')}-${String(k + 1).padStart(2, '0')}.jpg`;
      return { name, url: placeholderPhoto(name) };
    });
  },
};
