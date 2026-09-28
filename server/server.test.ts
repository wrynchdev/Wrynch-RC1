import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { candidatesFor, validateProposal } from './ai';
import { mapVpic } from './vin';
import { aiSort, aiWording, report, sendReport } from './routes';
import { DEFAULT_TEMPLATE, clsByName, compKey } from '../src/domain/ontology';
import { seedInspections, vehicle } from '../src/domain/seed';

const runner = vehicle('v-4runner');

test('candidates for under car on the 4Runner exclude parts that do not apply and non-photo parts', () => {
  const c = candidatesFor(DEFAULT_TEMPLATE, 'under_car', runner.config);
  const keys = c.map((x) => x.key);
  assert.ok(keys.includes(compKey(clsByName('brake_rotor').id, 'left_front')));
  assert.ok(!keys.includes(compKey(clsByName('brake_drum').id, 'left_rear')), 'rear disc car has no drums');
  assert.equal(new Set(keys).size, keys.length, 'no duplicates');
});

test('AI output is validated against the candidates and the ontology', () => {
  const c = candidatesFor(DEFAULT_TEMPLATE, 'under_car', runner.config);
  const rotor = compKey(clsByName('brake_rotor').id, 'left_front');
  const ok = validateProposal('m', { part: rotor, confidence: 0.9, finding: { key: 'grooved', severity: 'moderate', confidence: 0.8, rationale: 'grooves' } }, c);
  assert.equal(ok.key, rotor);
  assert.equal(ok.finding?.key, 'grooved');
  assert.equal(validateProposal('m', { part: rotor, confidence: 0.9, finding: { key: 'dent', severity: 'minor' } }, c).finding, null, 'finding not allowed on rotors');
  assert.equal(validateProposal('m', { part: '999@nowhere', confidence: 0.99, finding: null }, c).key, null, 'unknown part');
  assert.equal(validateProposal('m', { part: rotor, confidence: 0.3, finding: null }, c).key, null, 'low confidence waits for the tech');
  assert.equal(validateProposal('m', 'garbage', c).key, null);
  assert.equal(validateProposal('m', { part: rotor, confidence: 7, finding: { key: 'grooved', severity: 'extreme' } }, c).finding, null, 'bad severity');
});

test('VIN mapping: 4WD SUV, EV, pickup', () => {
  const suv = mapVpic('JTEBU5JR4B5012345', { ModelYear: '2011', Make: 'TOYOTA', Model: '4Runner', Trim: 'SR5', DriveType: '4WD/4-Wheel Drive/4x4',
    FuelTypePrimary: 'Gasoline', DisplacementL: '4.0', EngineCylinders: '6', TransmissionStyle: 'Automatic', BodyClass: 'Sport Utility Vehicle (SUV)/Multi-Purpose Vehicle (MPV)' });
  assert.equal(suv.make, 'Toyota');
  assert.equal(suv.config.drivetrain, '4wd');
  assert.equal(suv.config.transferCase, true);
  assert.equal(suv.engine, '4.0L 6-cyl Gasoline');
  assert.ok(suv.fromVin.includes('drivetrain'));
  const ev = mapVpic('5YJ3E1EA1MF000000', { ModelYear: '2021', Make: 'TESLA', Model: 'Model 3', DriveType: 'RWD/Rear-Wheel Drive', FuelTypePrimary: 'Electric', ElectrificationLevel: 'BEV (Battery Electric Vehicle)' });
  assert.equal(ev.config.powertrain, 'ev');
  assert.equal(ev.config.timing, 'none');
  assert.equal(ev.config.rearDiff, false);
  const truck = mapVpic('1FTFW1E50GF000000', { ModelYear: '2016', Make: 'FORD', Model: 'F-150', DriveType: '4WD/4-Wheel Drive/4x4', BodyClass: 'Pickup', FuelTypePrimary: 'Gasoline' });
  assert.equal(truck.config.rearSprings, 'leaf');
});

// ---------------------------------------------------------------- endpoints with a fake Supabase / AI
const realFetch = globalThis.fetch;
let calls: { url: string; body: unknown; auth: string | null }[] = [];
let respond: (url: string, body: unknown) => unknown;

beforeEach(() => {
  process.env.SUPABASE_URL = 'https://db.test';
  process.env.SUPABASE_ANON_KEY = 'anon';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service';
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.TWILIO_ACCOUNT_SID;
  calls = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = init?.body && typeof init.body === 'string' ? JSON.parse(init.body) : null;
    calls.push({ url, body, auth: new Headers(init?.headers).get('authorization') });
    const out = respond(url, body);
    if (out instanceof Response) return out;
    return new Response(JSON.stringify(out ?? null), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
});
afterEach(() => { globalThis.fetch = realFetch; });

function bundle(mut?: (i: ReturnType<typeof seedInspections>[number]) => void) {
  const insp = structuredClone(seedInspections().find((i) => i.id === 'i-4r-now')!);
  insp.reportToken = 'a'.repeat(64);
  mut?.(insp);
  return { inspection: insp, vehicle: runner, template: DEFAULT_TEMPLATE };
}
const post = (path: string, body: unknown, jwt = 'user-jwt') =>
  new Request(`https://app.test/api/${path}`, { method: 'POST', headers: { authorization: `Bearer ${jwt}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });

test('ai-sort requires sign-in and records proposals with the service key only', async () => {
  assert.equal((await aiSort(new Request('https://app.test/api/ai-sort', { method: 'POST', body: '{}' }))).status, 401);
  respond = (url) => (url.endsWith('/get_inspection') ? bundle((i) => {
    i.media = [1, 2, 3].map((n) => ({ id: `m${n}`, sectionId: 'under_car', url: `s/i/m${n}.jpg`, label: `IMG_${n}.jpg`, pointId: null, compKey: null,
      status: 'unassigned', confidence: null, aiGuess: null, history: [], customerVisible: true }));
  }) : null);
  const r = await aiSort(post('ai-sort', { inspectionId: 'i-4r-now', mediaIds: ['m1', 'm2', 'm3'] }));
  assert.equal(r.status, 200);
  assert.equal((await r.json()).model, 'stub');
  const get = calls.find((c) => c.url.endsWith('/get_inspection'))!;
  assert.equal(get.auth, 'Bearer user-jwt', 'inspection loaded as the user (RLS decides access)');
  const rec = calls.find((c) => c.url.endsWith('/ai_record_sort'))!;
  assert.equal(rec.auth, 'Bearer service');
  assert.equal((rec.body as { p_items: unknown[] }).p_items.length, 3);
});

test('ai-sort with Claude: model output is validated before it is stored', async () => {
  process.env.ANTHROPIC_API_KEY = 'k';
  const rotor = compKey(clsByName('brake_rotor').id, 'left_front');
  respond = (url) => {
    if (url.endsWith('/get_inspection')) return bundle((i) => {
      i.media = [{ id: 'm1', sectionId: 'under_car', url: 's/i/m1.jpg', label: 'a.jpg', pointId: null, compKey: null, status: 'unassigned', confidence: null, aiGuess: null, history: [], customerVisible: true }];
    });
    if (url.includes('/storage/v1/object/inspection-media/')) return new Response(new Uint8Array([255, 216, 255]), { headers: { 'content-type': 'image/jpeg' } });
    if (url.startsWith('https://api.anthropic.com')) return { content: [{ type: 'tool_use', input: { part: rotor, confidence: 0.92, finding: { key: 'crack', severity: 'minor', confidence: 0.7, rationale: 'hairline crack' } } }] };
    return null;
  };
  const r = await aiSort(post('ai-sort', { inspectionId: 'i-4r-now', mediaIds: ['m1'] }));
  assert.equal(r.status, 200);
  const ai = calls.find((c) => c.url.startsWith('https://api.anthropic.com'))!;
  const b = ai.body as { tool_choice: { name: string }; messages: { content: { type: string }[] }[] };
  assert.equal(b.tool_choice.name, 'record_photo');
  assert.equal(b.messages[0].content[0].type, 'image');
  const items = (calls.find((c) => c.url.endsWith('/ai_record_sort'))!.body as { p_items: { key: string; finding: { key: string } }[] }).p_items;
  assert.equal(items[0].key, rotor);
  assert.equal(items[0].finding.key, 'crack');
});

test('ai-wording rejects a model rewrite that changes numbers and falls back safely', async () => {
  process.env.ANTHROPIC_API_KEY = 'k';
  respond = (url) => {
    if (url.endsWith('/get_inspection')) return bundle((i) => { i.notes = [{ pointId: 'S24', techText: 'fronts 5mm rotors grooved', aiText: null, status: 'technician_original', customerText: null }]; });
    if (url.startsWith('https://api.anthropic.com')) return { content: [{ type: 'tool_use', input: { text: 'Your front pads are at 3 mm and need replacing.' } }] };
    return null;
  };
  const r = await aiWording(post('ai-wording', { inspectionId: 'i-4r-now', pointId: 'S24' }));
  const { text } = await r.json();
  assert.ok(text.includes('5'), text);
  assert.ok(!text.includes('3 mm'), 'hallucinated measurement was rejected');
});

test('customer report signs only the photos the database returned', async () => {
  respond = (url) => {
    if (url.endsWith('/customer_report')) return { ...bundle((i) => { i.media = [{ id: 'm1', sectionId: 'under_car', url: 's/i/m1.jpg', label: 'a', pointId: 'S24', compKey: null, status: 'confirmed', confidence: null, aiGuess: null, history: [], customerVisible: true }]; }), shop: { name: 'Demo', phone: null } };
    if (url.includes('/object/sign/')) return [{ path: 's/i/m1.jpg', signedURL: '/object/sign/inspection-media/s/i/m1.jpg?token=x' }];
    return null;
  };
  assert.equal((await report(new Request('https://app.test/api/report?token=nope'))).status, 404);
  const r = await report(new Request(`https://app.test/api/report?token=${'a'.repeat(64)}`));
  const doc = await r.json();
  assert.equal(doc.inspection.media[0].url, 'https://db.test/storage/v1/object/sign/inspection-media/s/i/m1.jpg?token=x');
  assert.equal(calls.find((c) => c.url.endsWith('/customer_report'))!.auth, 'Bearer service');
});

test('send-report: without a text provider it records the link and says texting is not set up', async () => {
  respond = (url) => (url.endsWith('/get_inspection') ? bundle((i) => { i.status = 'submitted'; }) : null);
  const r = await sendReport(post('send-report', { inspectionId: 'i-4r-now', channel: 'sms', to: '555-0100' }));
  const out = await r.json();
  assert.equal(out.status, 'skipped');
  assert.match(out.link, /#\/r\/a{64}$/);
  const mark = calls.find((c) => c.url.endsWith('/mark_sent'))!;
  assert.equal(mark.auth, 'Bearer user-jwt', 'sending is recorded as the user so the role check applies');
});

test('new-style secret keys go only in the apikey header', async () => {
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'sb_secret_test';
  respond = (url) => (url.endsWith('/customer_report') ? { ...bundle((i) => { i.media = []; }), shop: { name: 'Demo', phone: null } } : []);
  const r = await report(new Request(`https://app.test/api/report?token=${'a'.repeat(64)}`));
  assert.equal(r.status, 200);
  const c = calls.find((x) => x.url.endsWith('/customer_report'))!;
  assert.equal(c.auth, null, 'no Authorization header with a sb_secret_ key');
});

test('send-report refuses an inspection the tech has not finished', async () => {
  respond = (url) => (url.endsWith('/get_inspection') ? bundle() : null);
  assert.equal((await sendReport(post('send-report', { inspectionId: 'i-4r-now', channel: 'link' }))).status, 409);
});
