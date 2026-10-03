// Declined work: parts a customer saw rated Monitor or Immediate on a sent report and didn't approve, and when to
// follow up on each one.
//
// The follow-up date comes from the part itself when it can. A part measured on two or more visits (pad thickness,
// tread depth, brake-fluid copper, battery strength…) has a wear rate, so Wrynch projects the day it reaches the
// shop's Immediate limit and follows up ahead of that. Parts without a trend fall back to fixed intervals.
//
// An item closes on its own when a later visit shows the work was approved (recovered) or the part rated OK, and a
// newer sent report that declines the same part replaces the older item. A later visit that is still open means the
// vehicle is in the shop now, which is the best moment to bring it up.
import { compLabel, findingLabel, ONTOLOGY } from './ontology';
import { componentState, countsFinding } from './rating';
import type { CompKey, Inspection, Op, Vehicle } from './types';

export type FollowupStatus = 'open' | 'contacted' | 'booked' | 'dismissed';
/** What the shop has done about one declined item (one part on one sent inspection). */
export interface Followup {
  inspectionId: string;
  compKey: CompKey;
  status: FollowupStatus;
  /** A date the advisor picked ("remind me on…"); overrides the computed one. */
  dueOn: string | null;
  contactedAt: string | null;
  contacts: number;
  note: string | null;
  updatedAt: string;
}

/** Timing rules, in days. */
export const FOLLOW_UP = {
  /** Immediate items: call back this soon after the visit. */
  immediate: 2,
  /** Monitor items with no wear trend: check in this long after the visit. */
  monitor: 90,
  /** Monitor items with a trend: reach out this long before the part is projected to reach the Immediate limit. */
  lead: 30,
  /** Never sooner than this after the visit (unless the part is already at the limit). */
  soonest: 7,
  /** After a text, wait this long before the item is due again. */
  recontact: 14,
  /** Projections further out than this aren't shown as a date. */
  horizon: 730,
};

export interface Reading { checkKey: string; name: string; unit: string | null; value: number; date: string; limit: number; limitOp: Op }
export interface Forecast {
  /** Projected day the part reaches the Immediate limit (null when it's further out than the horizon). */
  date: string | null;
  /** Projected odometer at that point, when the visits recorded mileage. */
  odometer: number | null;
  /** Change per month, in the reading's unit (negative when the value is falling). */
  perMonth: number;
  /** Visits the trend is based on. */
  points: number;
  /** The latest reading is already at the limit. */
  reached: boolean;
}

export type ItemState = 'due' | 'upcoming' | 'contacted' | 'booked' | 'dismissed' | 'won' | 'resolved';
export interface DeclinedItem {
  id: string;
  inspectionId: string;
  ro: string;
  vehicleId: string;
  compKey: CompKey;
  label: string;
  rating: 'monitor' | 'immediate';
  /** The visit the work was recommended on. */
  recommendedOn: string;
  /** Estimate lines for this part on that visit (parts + labor, dollars). */
  amount: number;
  findings: string[];
  reading: Reading | null;
  forecast: Forecast | null;
  dueOn: string;
  dueWhy: string;
  state: ItemState;
  followup: Followup | null;
  /** A later visit that's still open: the vehicle is (or was just) in the shop. */
  inShop: { inspectionId: string; ro: string } | null;
  /** How the item closed: approved on a later visit (recovered) or rated OK later. */
  closed: { inspectionId: string; date: string; how: 'approved' | 'rated_ok'; amount: number } | null;
  reportToken: string | null;
}

const DAY = 86_400_000;
const toDay = (iso: string) => Date.parse(`${iso.slice(0, 10)}T12:00:00Z`) / DAY;
const fromDay = (d: number) => new Date(Math.round(d) * DAY + DAY / 2).toISOString().slice(0, 10);
export const addDays = (iso: string, days: number) => fromDay(toDay(iso) + days);
const later = (a: string, b: string) => (a > b ? a : b);

const amountFor = (i: Inspection, key: CompKey) =>
  Math.round(i.estimate.filter((e) => e.compKey === key).reduce((a, e) => a + Number(e.parts) + Number(e.labor), 0) * 100) / 100;

/** Parts an inspection says something about (rated, flagged or skipped). */
function touched(i: Inspection): CompKey[] {
  const keys = new Set<CompKey>();
  for (const r of i.results) keys.add(r.compKey);
  for (const f of i.findings) if (countsFinding(f)) keys.add(f.compKey);
  for (const s of i.statuses) if (s.override) keys.add(s.compKey);
  return [...keys];
}

/** Least-squares slope of y against x (null with fewer than two distinct x values). */
function slope(pts: { x: number; y: number }[]): number | null {
  if (pts.length < 2) return null;
  const mx = pts.reduce((a, p) => a + p.x, 0) / pts.length;
  const my = pts.reduce((a, p) => a + p.y, 0) / pts.length;
  const sxx = pts.reduce((a, p) => a + (p.x - mx) ** 2, 0);
  if (sxx === 0) return null;
  return pts.reduce((a, p) => a + (p.x - mx) * (p.y - my), 0) / sxx;
}

const atLimit = (op: Op, v: number, limit: number) =>
  op === '<' ? v < limit : op === '<=' ? v <= limit : op === '>' ? v > limit : v >= limit;

/**
 * The part's latest measurement on a check with an Immediate limit, and where its trend across visits is heading.
 * The check measured most recently is used (a pad's thickness rather than an older wear-pattern note).
 */
export function wearTrend(visits: Inspection[], key: CompKey): { reading: Reading | null; forecast: Forecast | null } {
  const byCheck = new Map<string, { date: string; odometer: number; value: number }[]>();
  for (const i of [...visits].filter((x) => x.status !== 'not_started').sort((a, b) => a.date.localeCompare(b.date))) {
    for (const r of i.results) {
      if (r.compKey !== key || r.value === null || !ONTOLOGY.checks[r.checkKey]?.auto?.immediate) continue;
      const list = byCheck.get(r.checkKey) ?? [];
      const prev = list.find((p) => p.date === i.date);
      if (prev) { prev.value = Number(r.value); prev.odometer = i.odometer; } else list.push({ date: i.date, odometer: i.odometer, value: Number(r.value) });
      byCheck.set(r.checkKey, list);
    }
  }
  let pick: [string, { date: string; odometer: number; value: number }[]] | null = null;
  for (const e of byCheck) if (!pick || e[1].at(-1)!.date > pick[1].at(-1)!.date) pick = e;
  if (!pick) return { reading: null, forecast: null };
  const [checkKey, pts] = pick;
  const check = ONTOLOGY.checks[checkKey];
  const [limitOp, limit] = check.auto!.immediate!;
  const last = pts.at(-1)!;
  const reading: Reading = { checkKey, name: check.name, unit: check.unit, value: last.value, date: last.date, limit, limitOp };
  if (atLimit(limitOp, last.value, limit)) {
    return { reading, forecast: { date: last.date, odometer: last.odometer || null, perMonth: 0, points: pts.length, reached: true } };
  }
  const perDay = slope(pts.map((p) => ({ x: toDay(p.date), y: p.value })));
  // Wearing toward the limit means falling for "at or below" limits and rising for "at or above" ones.
  const toward = limitOp === '<' || limitOp === '<=' ? -1 : 1;
  if (perDay === null || Math.sign(perDay) !== toward) return { reading, forecast: null };
  const days = (limit - last.value) / perDay;
  const miles = pts.filter((p) => p.odometer > 0);
  const perMile = miles.length >= 2 ? slope(miles.map((p) => ({ x: p.odometer, y: p.value }))) : null;
  const odometer = perMile !== null && Math.sign(perMile) === toward && last.odometer > 0
    ? Math.round((last.odometer + (limit - last.value) / perMile) / 100) * 100 : null;
  return {
    reading,
    forecast: {
      date: days <= FOLLOW_UP.horizon ? addDays(last.date, days) : null,
      odometer, perMonth: Math.round(perDay * 30.44 * 1000) / 1000, points: pts.length, reached: false,
    },
  };
}

function schedule(it: Pick<DeclinedItem, 'rating' | 'recommendedOn' | 'forecast'>, f: Followup | null): { dueOn: string; dueWhy: string } {
  let dueOn: string; let dueWhy: string;
  if (it.rating === 'immediate' || it.forecast?.reached) {
    dueOn = addDays(it.recommendedOn, FOLLOW_UP.immediate);
    dueWhy = it.forecast?.reached ? 'Already at the replacement limit' : 'Needs attention now';
  } else if (it.forecast?.date) {
    dueOn = later(addDays(it.forecast.date, -FOLLOW_UP.lead), addDays(it.recommendedOn, FOLLOW_UP.soonest));
    dueWhy = `About a month before it’s projected to need replacing`;
  } else {
    dueOn = addDays(it.recommendedOn, FOLLOW_UP.monitor);
    dueWhy = `${FOLLOW_UP.monitor} days after the visit`;
  }
  if (f?.contactedAt) {
    const again = addDays(f.contactedAt, FOLLOW_UP.recontact);
    if (again > dueOn) { dueOn = again; dueWhy = 'Two weeks after the last message'; }
  }
  if (f?.dueOn) { dueOn = f.dueOn; dueWhy = 'Date you picked'; }
  return { dueOn, dueWhy };
}

/**
 * Every declined item across these inspections, open and closed, soonest due first. `today` is an ISO date.
 * Inspections of all of a vehicle's visits should be included, so later visits can close or replace items.
 */
export function declinedWork(inspections: Inspection[], vehicles: Vehicle[], followups: Followup[], today: string): DeclinedItem[] {
  const out: DeclinedItem[] = [];
  const fu = new Map(followups.map((f) => [`${f.inspectionId}|${f.compKey}`, f]));
  const byVehicle = new Map<string, Inspection[]>();
  for (const i of inspections) if (i.status !== 'not_started') byVehicle.set(i.vehicleId, [...(byVehicle.get(i.vehicleId) ?? []), i]);

  for (const [vehicleId, visitsRaw] of byVehicle) {
    if (!vehicles.some((v) => v.id === vehicleId)) continue;
    const visits = [...visitsRaw].sort((a, b) => a.date.localeCompare(b.date) || (a.startedAt ?? '').localeCompare(b.startedAt ?? ''));
    const keys = new Set(visits.flatMap(touched));
    for (const key of keys) {
      let open: DeclinedItem | null = null;
      for (const i of visits) {
        const st = componentState(i, key);
        const rated = st === 'monitor' || st === 'immediate';
        // A later visit still being worked on means the vehicle is in the shop; a later sent report means it left.
        if (open && i.id !== open.inspectionId) open.inShop = i.status === 'sent' ? null : { inspectionId: i.id, ro: i.ro };
        if (open && st === 'ok') {
          open.closed = { inspectionId: i.id, date: i.date, how: 'rated_ok', amount: 0 };
          out.push(open); open = null; continue;
        }
        if (i.status !== 'sent' || !rated) continue;
        if (i.customerApprovals.includes(key)) {
          if (open) { open.closed = { inspectionId: i.id, date: i.date, how: 'approved', amount: amountFor(i, key) || open.amount }; out.push(open); open = null; }
          continue;
        }
        open = {
          id: `${i.id}|${key}`, inspectionId: i.id, ro: i.ro, vehicleId, compKey: key, label: compLabel(key), rating: st as 'monitor' | 'immediate',
          recommendedOn: i.date, amount: amountFor(i, key),
          findings: i.findings.filter((f) => f.compKey === key && countsFinding(f)).map((f) => findingLabel(f.key)),
          reading: null, forecast: null, dueOn: '', dueWhy: '', state: 'upcoming', followup: fu.get(`${i.id}|${key}`) ?? null,
          inShop: null, closed: null, reportToken: i.reportToken ?? null,
        };
      }
      if (open) out.push(open);
    }
    for (const it of out) {
      if (it.vehicleId !== vehicleId || it.dueOn) continue;
      Object.assign(it, wearTrend(visits, it.compKey));
      Object.assign(it, schedule(it, it.followup));
    }
  }
  for (const it of out) it.state = stateOf(it, today);
  return out.sort((a, b) => a.dueOn.localeCompare(b.dueOn) || a.label.localeCompare(b.label));
}

function stateOf(it: DeclinedItem, today: string): ItemState {
  if (it.closed) return it.closed.how === 'approved' ? 'won' : 'resolved';
  const s = it.followup?.status;
  if (s === 'booked' || s === 'dismissed') return s;
  if (it.dueOn <= today) return 'due';
  return s === 'contacted' ? 'contacted' : 'upcoming';
}

export interface DeclinedTotals { due: number; open: number; openAmount: number; recovered: number; recoveredJobs: number }
/** Counts for the top of the screen; recovered work is counted when the later visit was within `days` of today. */
export function declinedTotals(items: DeclinedItem[], today: string, days = 90): DeclinedTotals {
  const since = addDays(today, -days);
  const open = items.filter((i) => i.state === 'due' || i.state === 'upcoming' || i.state === 'contacted');
  const won = items.filter((i) => i.state === 'won' && i.closed!.date >= since);
  return {
    due: items.filter((i) => i.state === 'due').length,
    open: open.length,
    openAmount: Math.round(open.reduce((a, i) => a + i.amount, 0) * 100) / 100,
    recovered: Math.round(won.reduce((a, i) => a + i.closed!.amount, 0) * 100) / 100,
    recoveredJobs: new Set(won.map((i) => i.closed!.inspectionId)).size,
  };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "Mar 14" (or "Mar 14, 2025" when the year isn't `thisYear`). */
export function shortDate(iso: string, thisYear?: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${MONTHS.at(Number(m) - 1)} ${Number(d)}${thisYear && y !== thisYear ? `, ${y}` : ''}`;
}
export function monthYear(iso: string): string {
  const [y, m] = iso.slice(0, 10).split('-');
  return `${MONTHS.at(Number(m) - 1)} ${y}`;
}

/** "4 mm", "5/32 in", "78% of rated". */
export function fmtValue(value: number, unit: string | null): string {
  if (!unit) return String(value);
  return unit.startsWith('/') || unit.startsWith('%') ? `${value}${unit}` : `${value} ${unit}`;
}
/** "4 mm (limit: 2 mm or less)". */
export function readingText(r: Reading): string {
  const limit = r.limitOp === '<' ? `under ${fmtValue(r.limit, r.unit)}` : r.limitOp === '>' ? `over ${fmtValue(r.limit, r.unit)}`
    : `${fmtValue(r.limit, r.unit)} or ${r.limitOp === '<=' ? 'less' : 'more'}`;
  return `${fmtValue(r.value, r.unit)} (limit: ${limit})`;
}

/**
 * A short text for the customer from facts on the report: the part, the reading, the projection, and the link to
 * the report with photos. Nothing here is invented; parts without a reading are described by their rating only.
 */
export function reminderText(it: DeclinedItem, v: Vehicle, shop: string, reportUrl: string | null, today: string): string {
  const first = (v.customer ?? '').trim().split(/\s+/)[0];
  const car = `${v.year || ''} ${v.make} ${v.model}`.trim();
  const year = today.slice(0, 4);
  const part = it.label.replace(/ · /, ' (').concat(it.label.includes(' · ') ? ')' : '').toLowerCase();
  const reading = !it.reading ? '' : it.reading.date === it.recommendedOn ? ` It measured ${fmtValue(it.reading.value, it.reading.unit)}.`
    : ` It measured ${fmtValue(it.reading.value, it.reading.unit)} on ${shortDate(it.reading.date, year)}.`;
  let when: string;
  if (it.rating === 'immediate' || it.forecast?.reached) when = ' It’s due for replacement now.';
  else if (it.forecast?.date) when = ` Based on your visits, it’s likely to need replacing around ${monthYear(it.forecast.date)}${it.forecast.odometer ? ` (about ${it.forecast.odometer.toLocaleString('en-US')} miles)` : ''}.`;
  else when = ' It was close to needing attention.';
  return [
    `Hi${first ? ` ${first}` : ''}, this is ${shop}. At your ${shortDate(it.recommendedOn, year)} visit we recommended the ${part} on your ${car}.${reading}${when}`,
    'Want us to set up a time?',
    reportUrl ? `Photos and details: ${reportUrl}` : '',
  ].filter(Boolean).join(' ');
}

/**
 * One text covering everything a customer declined on one vehicle (a single item gets the fuller wording). The
 * report link is the newest report among the items.
 */
export function reminderForVehicle(items: DeclinedItem[], v: Vehicle, shop: string, reportUrl: string | null, today: string): string {
  if (items.length === 1) return reminderText(items[0], v, shop, reportUrl, today);
  const first = (v.customer ?? '').trim().split(/\s+/)[0];
  const car = `${v.year || ''} ${v.make} ${v.model}`.trim();
  const parts = items.map((it) => {
    const part = it.label.replace(/ · /, ' (').concat(it.label.includes(' · ') ? ')' : '').toLowerCase();
    const reading = it.reading ? ` ${fmtValue(it.reading.value, it.reading.unit)}` : '';
    const when = it.rating === 'immediate' || it.forecast?.reached ? ', due now' : it.forecast?.date ? `, likely due around ${monthYear(it.forecast.date)}` : '';
    return `${part}${reading}${when}`;
  });
  return [
    `Hi${first ? ` ${first}` : ''}, this is ${shop}. Following up on work we recommended for your ${car}: ${parts.join('; ')}.`,
    'Want us to set up a time?',
    reportUrl ? `Photos and details: ${reportUrl}` : '',
  ].filter(Boolean).join(' ');
}
