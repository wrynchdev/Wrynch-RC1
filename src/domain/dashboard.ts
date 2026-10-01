// Shop dashboard: stat cards, daily activity and recent events, from the rows the server returns
// (or, in the demo, from the inspections in the browser).
import type { Inspection, Vehicle } from './types';
import { summarize } from './rating';

export interface DashRow {
  id: string; ro: string; status: Inspection['status']; date: string;
  createdAt: string; submittedAt: string | null; sentAt: string | null;
  vehicle: string; customer: string; technician: string;
  immediate: number; monitor: number; estimate: number; approved: number;
  /** Recommended parts the customer approved (customer approvals are made on Monitor and Immediate parts). */
  approvedItems?: number;
}
export type DashEventKind = 'created' | 'submitted' | 'sent' | 'delivered' | 'approved';
export interface DashEvent { at: string; kind: DashEventKind; inspectionId: string; ro: string; vehicle: string; detail: string | null }
export interface DashData { days: number; money: boolean; rows: DashRow[]; events: DashEvent[]; /** Owner's estimate of the approval rate before Wrynch, in percent. */ baseline?: number | null }

export interface DayBucket { date: string; sent: number; review: number; progress: number }
export interface DashSummary {
  inProgress: number; awaitingReview: number; sent: number;
  quoted: number; approved: number; approvalRate: number | null; urgent: number;
  series: DayBucket[]; recent: DashEvent[];
  approval: Approval;
}
export interface WeekBucket { start: string; recommended: number; approved: number }
/** Of the work recommended on reports sent in the range (Monitor + Immediate parts), how much customers approved. */
export interface Approval { recommended: number; approved: number; rate: number | null; reports: number; baseline: number | null; change: number | null; weeks: WeekBucket[] }

/** Monday of the week a date falls in. */
export function weekStart(day: string): string {
  const d = new Date(`${day.slice(0, 10)}T12:00:00`);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return isoDay(d);
}

export function approvalRate(rows: DashRow[], range: string[], baseline: number | null | undefined): Approval {
  const inRange = new Set(range);
  const weeks = new Map<string, WeekBucket>();
  for (const d of range) { const w = weekStart(d); if (!weeks.has(w)) weeks.set(w, { start: w, recommended: 0, approved: 0 }); }
  let recommended = 0, approved = 0, reports = 0;
  for (const r of rows) {
    if (r.status !== 'sent' || !r.sentAt) continue;
    const day = isoDay(new Date(r.sentAt));
    if (!inRange.has(day)) continue;
    const rec = r.immediate + r.monitor;
    const ok = Math.min(r.approvedItems ?? 0, rec);
    reports++; recommended += rec; approved += ok;
    const w = weeks.get(weekStart(day))!;
    w.recommended += rec; w.approved += ok;
  }
  const rate = recommended ? approved / recommended : null;
  const base = baseline ?? null;
  return { recommended, approved, rate, reports, baseline: base, change: rate !== null && base !== null ? Math.round((rate * 100 - base) * 10) / 10 : null, weeks: [...weeks.values()] };
}

const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** The last `days` calendar days ending today, oldest first. */
export function dayRange(days: number, now = new Date()): string[] {
  const out: string[] = [];
  for (let k = days - 1; k >= 0; k--) { const d = new Date(now); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() - k); out.push(isoDay(d)); }
  return out;
}

export function summarizeDashboard(data: DashData, days: number, now = new Date()): DashSummary {
  const range = dayRange(days, now);
  const inRange = new Set(range);
  const buckets = new Map(range.map((d) => [d, { date: d, sent: 0, review: 0, progress: 0 }]));
  let quoted = 0, approved = 0, sent = 0;
  for (const r of data.rows) {
    const b = buckets.get(r.date.slice(0, 10));
    if (b) {
      if (r.status === 'sent') b.sent++;
      else if (r.status === 'submitted') b.review++;
      else b.progress++;
    }
    if (inRange.has(r.date.slice(0, 10)) && (r.status === 'sent' || r.status === 'submitted')) { quoted += r.estimate; approved += r.approved; }
    if (r.status === 'sent' && r.sentAt && inRange.has(isoDay(new Date(r.sentAt)))) sent++;
  }
  const open = data.rows.filter((r) => r.status === 'not_started' || r.status === 'in_progress');
  return {
    inProgress: open.length,
    awaitingReview: data.rows.filter((r) => r.status === 'submitted').length,
    sent,
    quoted: Math.round(quoted * 100) / 100,
    approved: Math.round(approved * 100) / 100,
    approvalRate: quoted > 0 ? approved / quoted : null,
    urgent: data.rows.filter((r) => r.status === 'submitted' && r.immediate > 0).length,
    series: [...buckets.values()],
    recent: data.events.filter((e) => inRange.has(isoDay(new Date(e.at)))).slice(0, 8),
    approval: approvalRate(data.rows, range, data.baseline),
  };
}

/** Demo mode: the same shape from the inspections held in the browser. */
export function dashFromInspections(inspections: Inspection[], vehicles: Vehicle[], money = true): DashData {
  const rows: DashRow[] = [];
  const events: DashEvent[] = [];
  for (const i of inspections) {
    const v = vehicles.find((x) => x.id === i.vehicleId);
    if (!v) continue;
    const s = summarize(i, v);
    const at = (h: number) => `${i.date}T${String(h).padStart(2, '0')}:00:00`;
    const vehicle = `${v.year} ${v.make} ${v.model}`;
    const estimate = i.estimate.reduce((a, e) => a + Number(e.parts) + Number(e.labor), 0);
    const approved = i.estimate.filter((e) => e.compKey && i.customerApprovals.includes(e.compKey)).reduce((a, e) => a + Number(e.parts) + Number(e.labor), 0);
    const submitted = i.status === 'submitted' || i.status === 'sent';
    rows.push({ id: i.id, ro: i.ro, status: i.status, date: i.date, createdAt: at(8), submittedAt: submitted ? at(10) : null, sentAt: i.status === 'sent' ? at(11) : null,
      vehicle, customer: v.customer ?? '', technician: i.technician, immediate: s.immediate, monitor: s.monitor,
      estimate: money ? estimate : 0, approved: money ? approved : 0, approvedItems: i.customerApprovals.length });
    const base = { inspectionId: i.id, ro: i.ro, vehicle, detail: null };
    events.push({ ...base, at: at(8), kind: 'created' });
    if (submitted) events.push({ ...base, at: at(10), kind: 'submitted' });
    if (i.status === 'sent') events.push({ ...base, at: at(11), kind: 'sent' });
    if (i.customerApprovals.length) events.push({ ...base, at: at(13), kind: 'approved', detail: String(i.customerApprovals.length) });
  }
  events.sort((a, b) => b.at.localeCompare(a.at));
  rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return { days: 7, money, rows, events };
}
