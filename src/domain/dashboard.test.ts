import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dashFromInspections, dayRange, summarizeDashboard, type DashData, type DashRow } from './dashboard';
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
