import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addDays, declinedTotals, declinedWork, FOLLOW_UP, readingText, reminderForVehicle, reminderText, wearTrend, type Followup } from './declined';
import { clsByName, compKey } from './ontology';
import { seedInspections, VEHICLES } from './seed';
import type { Inspection } from './types';

const TODAY = '2026-10-03';
const pad = (pos: string) => compKey(clsByName('brake_pad').id, pos);
const f150 = VEHICLES.find((v) => v.id === 'v-f150')!;
const items = (insp = seedInspections(), fu: Followup[] = []) => declinedWork(insp, VEHICLES, fu, TODAY);
const find = (list: ReturnType<typeof items>, vehicleId: string, label: string) => list.find((i) => i.vehicleId === vehicleId && i.label === label)!;

test('declined items come from sent reports: rated Monitor or Immediate and not approved', () => {
  const list = items();
  assert.ok(list.length > 0);
  assert.ok(list.every((i) => i.rating === 'monitor' || i.rating === 'immediate'));
  assert.ok(!list.some((i) => i.inspectionId === 'i-4r-now'), 'an inspection that is not sent declines nothing');
  // The 4Runner's brake fluid was declined in Oct 2025 and again in Mar 2026: only the newer one is open.
  const fluid = list.filter((i) => i.vehicleId === 'v-4runner' && i.label === 'Brake fluid');
  assert.equal(fluid.length, 1);
  assert.equal(fluid[0].inspectionId, 'i-4r-2');
});

test('a part measured on several visits gets a projected date, and follow-up comes before it', () => {
  const p = find(items(), 'v-f150', 'Brake pad · left front');
  assert.equal(p.reading?.value, 4);
  assert.equal(readingText(p.reading!), '4 mm (limit: 2 mm or less)');
  // 6 mm on Feb 10, 4 mm on Jul 22: 2 mm in 162 days, so 2 mm more lands 162 days after Jul 22.
  assert.equal(p.forecast?.date, addDays('2026-07-22', 162));
  assert.equal(p.forecast?.odometer, 73800, '2 mm per 7,700 miles');
  assert.equal(p.dueOn, addDays(p.forecast!.date!, -FOLLOW_UP.lead));
  assert.equal(p.state, 'upcoming');
  assert.equal(p.amount, 180);
});

test('a part already at the limit is due now; the vehicle being in the shop is flagged', () => {
  const fluid = find(items(), 'v-4runner', 'Brake fluid');
  assert.equal(fluid.reading?.value, 210, 'latest reading, from the visit in progress');
  assert.equal(fluid.forecast?.reached, true);
  assert.equal(fluid.state, 'due');
  assert.equal(fluid.inShop?.inspectionId, 'i-4r-now');
  const rotor = find(items(), 'v-4runner', 'Brake rotor · left front');
  assert.equal(rotor.forecast, null, 'a finding has no trend');
  assert.equal(rotor.dueOn, addDays('2026-03-14', FOLLOW_UP.monitor));
});

test('work approved on a later visit is recovered; a later OK rating closes the item', () => {
  const list = items();
  const tires = list.filter((i) => i.vehicleId === 'v-f150' && i.label.startsWith('Tire'));
  assert.equal(tires.length, 4);
  assert.ok(tires.every((t) => t.state === 'won' && t.closed?.inspectionId === 'i-f150-1' && t.closed.amount === 190));
  const t = declinedTotals(list, TODAY);
  assert.equal(t.recovered, 760);
  assert.equal(t.recoveredJobs, 1);
  assert.equal(declinedTotals(list, TODAY, 30).recovered, 0, 'outside the window');
  // The 4Runner's rotors rated OK on today's visit close the March item.
  const insp: Inspection[] = seedInspections();
  const now = insp.find((i) => i.id === 'i-4r-now')!;
  const rotor = compKey(clsByName('brake_rotor').id, 'left_front');
  now.results.push({ compKey: rotor, checkKey: 'brake_rotor.thickness', value: null, rating: 'ok', at: now.date });
  const closed = find(items(insp), 'v-4runner', 'Brake rotor · left front');
  assert.equal(closed.state, 'resolved');
});

test('what the shop did changes the date and the state', () => {
  const base = find(items(), 'v-f150', 'Brake pad · left front');
  const fu = (p: Partial<Followup>): Followup => ({ inspectionId: base.inspectionId, compKey: base.compKey, status: 'open', dueOn: null, contactedAt: null, contacts: 0, note: null, updatedAt: TODAY, ...p });
  assert.equal(find(items(undefined, [fu({ status: 'booked' })]), 'v-f150', 'Brake pad · left front').state, 'booked');
  assert.equal(find(items(undefined, [fu({ status: 'dismissed' })]), 'v-f150', 'Brake pad · left front').state, 'dismissed');
  const picked = find(items(undefined, [fu({ dueOn: '2026-10-01' })]), 'v-f150', 'Brake pad · left front');
  assert.deepEqual([picked.dueOn, picked.state], ['2026-10-01', 'due']);
  // Texted today about an item that's due: it waits two weeks before it's due again.
  const due = find(items(), 'v-4runner', 'Brake fluid');
  const texted = find(items(undefined, [{ ...fu({ status: 'contacted', contactedAt: TODAY, contacts: 1 }), inspectionId: due.inspectionId, compKey: due.compKey }]), 'v-4runner', 'Brake fluid');
  assert.equal(texted.dueOn, addDays(TODAY, FOLLOW_UP.recontact));
  assert.equal(texted.state, 'contacted');
});

test('trends only count when the part is wearing toward its limit', () => {
  const v = (date: string, value: number, odometer = 0): Inspection => ({
    id: date, ro: '', vehicleId: 'x', odometer, date, technician: '', status: 'sent', concerns: [], dtcs: [], findings: [], media: [], observations: [],
    statuses: [], notes: [], extraComponents: [], customerApprovals: [], estimate: [], results: [{ compKey: pad('left_front'), checkKey: 'brake_pad.lining_thickness', value, rating: 'monitor', at: date }],
  });
  assert.equal(wearTrend([v('2026-01-01', 4)], pad('left_front')).forecast, null, 'one visit is not a trend');
  assert.equal(wearTrend([v('2026-01-01', 4), v('2026-06-01', 9)], pad('left_front')).forecast, null, 'new pads went on');
  const far = wearTrend([v('2020-01-01', 4.3), v('2026-01-01', 4)], pad('left_front')).forecast!;
  assert.equal(far.date, null, 'beyond the horizon');
  assert.ok(far.perMonth < 0);
});

test('the reminder text sticks to what the report says', () => {
  const p = find(items(), 'v-f150', 'Brake pad · left front');
  const text = reminderText(p, f150, 'Reyes Auto Care', 'https://1001.wrynch.app/#/r/abc', TODAY);
  assert.match(text, /^Hi Lee, this is Reyes Auto Care\. At your Jul 22 visit we recommended the brake pad \(left front\) on your 2018 Ford F-150\./);
  assert.match(text, /It measured 4 mm\./);
  assert.match(text, /around Jan 2027 \(about 73,800 miles\)/);
  assert.match(text, /Photos and details: https:\/\/1001\.wrynch\.app\/#\/r\/abc$/);
  const rotor = find(items(), 'v-4runner', 'Brake rotor · left front');
  const t2 = reminderText(rotor, VEHICLES[0], 'Reyes Auto Care', null, TODAY);
  assert.doesNotMatch(t2, /measured|Photos/);
});

test('one text per vehicle lists each part', () => {
  const list = items().filter((i) => i.vehicleId === 'v-f150' && i.state === 'upcoming');
  const text = reminderForVehicle(list, f150, 'Reyes Auto Care', null, TODAY);
  assert.match(text, /^Hi Lee, this is Reyes Auto Care\. Following up on work we recommended for your 2018 Ford F-150: /);
  assert.match(text, /brake pad \(left front\) 4 mm, likely due around Jan 2027/);
  assert.match(text, /low voltage battery 78% of rated, likely due around Nov 2026/);
  assert.equal(reminderForVehicle(list.slice(0, 1), f150, 'X', null, TODAY), reminderText(list[0], f150, 'X', null, TODAY));
});
