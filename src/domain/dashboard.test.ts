import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dashFromInspections, dayRange, summarizeDashboard, weekStart, type DashData, type DashRow } from './dashboard';
import { seedInspections, VEHICLES } from './seed';

const row = (over: Partial<DashRow>): DashRow => ({
  id: 'x', ro: '1', status: 'in_progress', date: '2026-09-28', createdAt: '2026-09-28T09:00:00Z', submittedAt: null, sentAt: null,
  vehicle: '2011 Toyota 4Runner', customer: 'Dana', technician: 'Marcus', immediate: 0, monitor: 0, estimate: 0, approved: 0, ...over,
});
const now = new Date('2026-09-29T15:00:00');

test('day range ends today and has one entry per day', () => {
  assert.deepEqual(dayRange(3, now), ['2026-09-27', '2026-09-28', '2026-09-29']);
});

test('stat cards and daily buckets follow each inspection’s status', () => {
  const data: DashData = { days: 7, money: true, events: [], rows: [
    row({ id: 'a', status: 'in_progress' }),
    row({ id: 'b', status: 'not_started', date: '2026-09-29' }),
    row({ id: 'c', status: 'submitted', immediate: 2, estimate: 400 }),
    row({ id: 'd', status: 'sent', sentAt: '2026-09-29T10:00:00', estimate: 1000, approved: 250 }),
    row({ id: 'old', status: 'sent', date: '2026-08-01', sentAt: '2026-08-01T10:00:00', estimate: 999, approved: 999 }),
  ] };
  const s = summarizeDashboard(data, 7, now);
  assert.deepEqual([s.inProgress, s.awaitingReview, s.sent, s.urgent], [2, 1, 1, 1]);
  assert.deepEqual([s.quoted, s.approved], [1400, 250], 'only inspections in the range count toward dollars');
  assert.equal(Math.round(s.approvalRate! * 100), 18);
  assert.equal(s.series.length, 7);
  assert.deepEqual(s.series.find((b) => b.date === '2026-09-28'), { date: '2026-09-28', sent: 1, review: 1, progress: 1 });
  assert.equal(summarizeDashboard({ ...data, rows: [] }, 7, now).approvalRate, null, 'no quotes, no rate');
});

test('demo data produces rows and recent events', () => {
  const d = dashFromInspections(seedInspections(), structuredClone(VEHICLES));
  assert.ok(d.rows.length >= 3);
  assert.ok(d.events.some((e) => e.kind === 'created'));
  assert.ok(d.events.every((e, k) => k === 0 || d.events[k - 1].at >= e.at), 'newest first');
});

test('approval rate: approved recommended parts on reports sent in the range, by week, against the baseline', () => {
  const now = new Date('2026-10-01T12:00:00');
  const row = (id: string, sent: string | null, status: DashRow['status'], imm: number, mon: number, ok: number): DashRow => ({
    id, ro: id, status, date: (sent ?? '2026-09-30').slice(0, 10), createdAt: `${(sent ?? '2026-09-30').slice(0, 10)}T08:00:00`, submittedAt: null, sentAt: sent,
    vehicle: 'v', customer: '', technician: '', immediate: imm, monitor: mon, estimate: 0, approved: 0, approvedItems: ok,
  });
  const data: DashData = { days: 30, money: true, events: [], baseline: 30, rows: [
    row('a', '2026-09-29T10:00:00', 'sent', 1, 3, 2),   // this week (Mon Sep 28)
    row('b', '2026-09-22T10:00:00', 'sent', 2, 2, 1),   // last week
    row('c', '2026-08-01T10:00:00', 'sent', 1, 1, 1),   // outside 30 days
    row('d', null, 'submitted', 3, 0, 0),               // not sent yet: not counted
    row('e', '2026-09-30T10:00:00', 'sent', 0, 1, 5),   // approvals capped at what was recommended
  ] };
  const a = summarizeDashboard(data, 30, now).approval;
  assert.deepEqual([a.reports, a.recommended, a.approved], [3, 9, 4]);
  assert.equal(Math.round(a.rate! * 1000), 444);
  assert.equal(a.change, 14.4);
  const thisWeek = a.weeks.find((w) => w.start === '2026-09-28')!;
  const lastWeek = a.weeks.find((w) => w.start === '2026-09-21')!;
  assert.deepEqual([thisWeek.recommended, thisWeek.approved, lastWeek.recommended, lastWeek.approved], [5, 3, 4, 1]);
  assert.equal(weekStart('2026-10-04'), '2026-09-28', 'Sunday belongs to the week that started Monday');
  assert.equal(summarizeDashboard({ ...data, rows: [], baseline: null }, 7, now).approval.rate, null);
});
