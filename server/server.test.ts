import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { buildMappedPoint, candidatesFor, explainAiError, resetAiState, validateAnalysis } from './ai';
import { mapVpic } from './vin';
import { aiNote, aiSort, aiWording, appRoot, pilot, report, sendReport, status, templateMap, templateRead } from './routes';
import { resetRateLimits } from './lib';
import { DEFAULT_TEMPLATE, clsByName, compKey } from '../src/domain/ontology';
import { seedInspections, vehicle } from '../src/domain/seed';
import { SIDE_UNSURE_CONFIDENCE } from '../src/domain/types';

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
  const caliper = compKey(clsByName('brake_caliper').id, 'left_front');
  const tire = compKey(clsByName('tire').id, 'left_front');
  const a = validateAnalysis('m', { parts: [
    { part: rotor, confidence: 0.9, condition: 'concern', note: 'grooves', findings: [
      { key: 'grooved', severity: 'moderate', confidence: 0.8, rationale: 'grooves' }, { key: 'dent', severity: 'minor' }] },
    { part: caliper, confidence: 0.85, condition: 'looks_ok', note: 'dry', findings: [] },
    { part: tire, confidence: 0.8, condition: 'concern', findings: [{ key: 'grooved', severity: 'minor' }] },
    { part: '999@nowhere', confidence: 0.99, condition: 'looks_ok', findings: [] },
    { part: rotor, confidence: 0.9, condition: 'looks_ok', findings: [] },
    { part: compKey(clsByName('brake_pad').id, 'left_front'), confidence: 0.3, condition: 'looks_ok', findings: [] },
  ] }, c);
  assert.deepEqual(a.parts.map((p) => [p.key, p.condition]), [[rotor, 'concern'], [caliper, 'looks_ok'], [tire, 'unclear']],
    'unknown part, duplicate and low-confidence dropped; tire concern with no allowed finding becomes unclear');
  assert.deepEqual(a.parts[0].findings.map((f) => f.key), ['grooved'], 'finding not allowed on rotors dropped');
  assert.equal(validateAnalysis('m', 'garbage', c).parts.length, 0);
  assert.equal(validateAnalysis('m', { parts: [{ part: caliper, confidence: 0.9, condition: 'looks_ok', findings: [{ key: 'leak', severity: 'minor' }] }] }, c).parts[0].condition,
    'concern', 'a finding overrides "looks OK"');
});

test('candidates come only from the inspection points of the photo stage', () => {
  const c = candidatesFor(DEFAULT_TEMPLATE, 'under_car', runner.config);
  const stage = DEFAULT_TEMPLATE.sections.find((s) => s.id === 'under_car')!;
  assert.ok(c.length > 0);
  assert.ok(c.every((x) => x.stage === 'Under car' && stage.points.some((p) => p.name === x.point)), 'no parts from other stages');
  const hood = candidatesFor(DEFAULT_TEMPLATE, 'under_hood', runner.config).map((x) => x.key);
  assert.ok(hood.some((k) => !c.some((x) => x.key === k)), 'under-hood-only parts are not offered for under-car photos');
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
let calls: { url: string; body: unknown; auth: string | null; ws: string | null }[] = [];
let respond: (url: string, body: unknown) => unknown;

beforeEach(() => {
  process.env.SUPABASE_URL = 'https://db.test';
  process.env.SUPABASE_ANON_KEY = 'anon';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service';
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.AI_STUB;
  delete process.env.ANTHROPIC_WORKSPACE_ID;
  resetAiState();
  resetRateLimits();
  delete process.env.PILOT_NOTIFY_EMAIL; delete process.env.RESEND_API_KEY; delete process.env.EMAIL_FROM;
  delete process.env.TWILIO_ACCOUNT_SID;
  calls = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = init?.body && typeof init.body === 'string' ? JSON.parse(init.body) : null;
    calls.push({ url, body, auth: new Headers(init?.headers).get('authorization'), ws: new Headers(init?.headers).get('anthropic-workspace-id') });
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

test('without an AI key, ai-sort refuses instead of guessing, and status says AI is off', async () => {
  respond = (url) => (url.endsWith('/get_inspection') ? bundle() : null);
  const r = await aiSort(post('ai-sort', { inspectionId: 'i-4r-now', mediaIds: ['m1'] }));
  assert.equal(r.status, 503);
  assert.ok(!calls.some((c) => c.url.endsWith('/ai_record_sort')), 'nothing recorded');
  assert.deepEqual(await (await status(new Request('https://app.test/api/status'))).json(), { ai: false, model: 'off' });
  process.env.ANTHROPIC_API_KEY = 'k';
  assert.equal((await (await status(new Request('https://app.test/api/status'))).json()).ai, true);
});

test('ai-sort requires sign-in and records proposals with the service key only', async () => {
  process.env.AI_STUB = '1';
  assert.equal((await aiSort(new Request('https://app.test/api/ai-sort', { method: 'POST', body: '{}' }))).status, 401);
  respond = (url) => (url.endsWith('/get_inspection') ? bundle((i) => {
    i.media = [1, 2, 3].map((n) => ({ id: `m${n}`, sectionId: 'under_car', url: `s/i/m${n}.jpg`, label: `IMG_${n}.jpg`,
      excluded: false, customerVisible: true, analyzed: false, links: [] }));
    i.media.push({ id: 'm4', sectionId: 'under_car', url: 's/i/m4.jpg', label: 'done.jpg', excluded: false, customerVisible: true, analyzed: true, links: [] });
  }) : null);
  const r = await aiSort(post('ai-sort', { inspectionId: 'i-4r-now', mediaIds: ['m1', 'm2', 'm3', 'm4'] }));
  assert.equal(r.status, 200);
  assert.equal((await r.json()).model, 'stub');
  const get = calls.find((c) => c.url.endsWith('/get_inspection'))!;
  assert.equal(get.auth, 'Bearer user-jwt', 'inspection loaded as the user (RLS decides access)');
  const rec = calls.find((c) => c.url.endsWith('/ai_record_sort'))!;
  assert.equal(rec.auth, 'Bearer service');
  assert.equal((rec.body as { p_items: unknown[] }).p_items.length, 3, 'an already-analysed photo is skipped');
});

test('ai-sort with Claude: model output is validated before it is stored', async () => {
  process.env.ANTHROPIC_API_KEY = 'k';
  process.env.ANTHROPIC_WORKSPACE_ID = 'wrkspc_test';
  const rotor = compKey(clsByName('brake_rotor').id, 'left_front');
  const caliper = compKey(clsByName('brake_caliper').id, 'left_front');
  respond = (url) => {
    if (url.endsWith('/get_inspection')) return bundle((i) => {
      i.media = [{ id: 'm1', sectionId: 'under_car', url: 's/i/m1.jpg', label: 'a.jpg', excluded: false, customerVisible: true, analyzed: false, links: [] }];
    });
    if (url.includes('/storage/v1/object/inspection-media/')) return new Response(new Uint8Array([255, 216, 255]), { headers: { 'content-type': 'image/jpeg' } });
    if (url.startsWith('https://api.anthropic.com')) return { content: [{ type: 'tool_use', input: { parts: [
      { part: rotor, confidence: 0.92, condition: 'concern', note: 'crack at a vent', findings: [{ key: 'crack', severity: 'minor', confidence: 0.7, rationale: 'hairline crack' }] },
      { part: caliper, confidence: 0.88, position_certain: true, condition: 'looks_ok', note: 'dry', findings: [] }] } }] };
    return null;
  };
  const r = await aiSort(post('ai-sort', { inspectionId: 'i-4r-now', mediaIds: ['m1'] }));
  assert.equal(r.status, 200);
  const ai = calls.find((c) => c.url.startsWith('https://api.anthropic.com'))!;
  const b = ai.body as { tool_choice: { name: string }; messages: { content: { type: string }[] }[] };
  assert.equal(b.tool_choice.name, 'record_photo');
  assert.equal(ai.ws, 'wrkspc_test', 'workspace header sent when configured');
  assert.equal(b.messages[0].content[0].type, 'image');
  const items = (calls.find((c) => c.url.endsWith('/ai_record_sort'))!.body as { p_items: { parts: { key: string; condition: string; findings: { key: string }[] }[] }[] }).p_items;
  assert.deepEqual(items[0].parts.map((p) => [p.key, p.condition]), [[rotor, 'concern'], [caliper, 'looks_ok']], 'one photo, two parts');
  assert.equal(items[0].parts[0].findings[0].key, 'crack');
});

test('ai-sort: a part on an uncertain side is a hint only; a failed AI call leaves the photo retryable', async () => {
  process.env.ANTHROPIC_API_KEY = 'k';
  const rotor = compKey(clsByName('brake_rotor').id, 'left_front');
  let fail = false;
  respond = (url) => {
    if (url.endsWith('/get_inspection')) return bundle((i) => {
      i.media = [{ id: 'm1', sectionId: 'under_car', url: 's/i/m1.jpg', label: 'a.jpg', excluded: false, customerVisible: true, analyzed: false, links: [] }];
    });
    if (url.includes('/storage/v1/object/inspection-media/')) return new Response(new Uint8Array([255, 216, 255]), { headers: { 'content-type': 'image/jpeg' } });
    if (url.startsWith('https://api.anthropic.com')) return fail ? new Response('overloaded', { status: 529 }) : { content: [{ type: 'tool_use', input: { view: 'close-up of a front brake', parts: [
      { part: rotor, confidence: 0.9, position_certain: false, condition: 'concern', note: 'grooved', findings: [{ key: 'crack', severity: 'minor', confidence: 0.7, rationale: 'x' }] }] } }] };
    return null;
  };
  await aiSort(post('ai-sort', { inspectionId: 'i-4r-now', mediaIds: ['m1'] }));
  const part = (calls.find((c) => c.url.endsWith('/ai_record_sort'))!.body as { p_items: { parts: { key: string; confidence: number; condition: string; findings: unknown[] }[] }[] }).p_items[0].parts[0];
  assert.deepEqual([part.key, part.confidence, part.condition, part.findings.length], [rotor, SIDE_UNSURE_CONFIDENCE, 'unclear', 0], 'no condition claims on a guessed side');

  calls = []; fail = true;
  const r = await aiSort(post('ai-sort', { inspectionId: 'i-4r-now', mediaIds: ['m1'] }));
  assert.equal(r.status, 502);
  assert.ok(!calls.some((c) => c.url.endsWith('/ai_record_sort')), 'failed photo not marked as analysed');
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
    if (url.endsWith('/customer_report')) return { ...bundle((i) => { i.media = [{ id: 'm1', sectionId: 'under_car', url: 's/i/m1.jpg', label: 'a', excluded: false, customerVisible: true, analyzed: true, links: [{ compKey: '71@left_front', status: 'confirmed', confidence: null }] }]; }), shop: { name: 'Demo', phone: null } };
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

test('a Supabase address pasted with /rest/v1/ still works', async () => {
  process.env.SUPABASE_URL = 'https://db.test/rest/v1/';
  respond = (url) => (url.endsWith('/customer_report') ? { ...bundle((i) => { i.media = []; }), shop: { name: 'Demo', phone: null } } : []);
  await report(new Request(`https://app.test/api/report?token=${'a'.repeat(64)}`));
  assert.ok(calls.some((c) => c.url === 'https://db.test/rest/v1/rpc/customer_report'), calls.map((c) => c.url).join());
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

test('AI errors are explained in plain language without leaking the key', () => {
  assert.match(explainAiError(401, JSON.stringify({ error: { type: 'authentication_error', message: 'invalid x-api-key' } })), /key isn’t valid/);
  assert.match(explainAiError(400, JSON.stringify({ error: { type: 'invalid_request_error', message: 'Your credit balance is too low to access the Anthropic API.' } })), /out of credit/);
  assert.match(explainAiError(404, JSON.stringify({ error: { type: 'not_found_error', message: 'model: x' } })), /isn’t available/);
  assert.match(explainAiError(529, 'overloaded'), /busy/);
  assert.match(explainAiError(400, JSON.stringify({ error: { type: 'invalid_request_error', message: 'This API key is not scoped to a workspace, so this request must include the anthropic-workspace-id header' } })), /ANTHROPIC_WORKSPACE_ID/);
});

test('ai-sort reports why a photo could not be read (unsupported format)', async () => {
  process.env.ANTHROPIC_API_KEY = 'k';
  respond = (url) => {
    if (url.endsWith('/get_inspection')) return bundle((i) => {
      i.media = [{ id: 'm1', sectionId: 'under_car', url: 's/i/m1.heic', label: 'a.heic', excluded: false, customerVisible: true, analyzed: false, links: [] }];
    });
    if (url.includes('/storage/v1/object/inspection-media/')) return new Response(new Uint8Array([0, 0, 0]), { headers: { 'content-type': 'image/heic' } });
    return null;
  };
  const r = await aiSort(post('ai-sort', { inspectionId: 'i-4r-now', mediaIds: ['m1'] }));
  assert.equal(r.status, 502);
  assert.match((await r.json()).error, /image\/heic; the AI reads JPEG/);
  assert.ok(!calls.some((c) => c.url.startsWith('https://api.anthropic.com')), 'unsupported photo never sent');
});

test('a model that refuses a forced tool choice is asked again with auto and still recorded', async () => {
  process.env.ANTHROPIC_API_KEY = 'k';
  const caliper = compKey(clsByName('brake_caliper').id, 'left_front');
  const aiBodies: { tool_choice: { type: string } }[] = [];
  respond = (url, body) => {
    if (url.endsWith('/get_inspection')) return bundle((i) => {
      i.media = [{ id: 'm1', sectionId: 'under_car', url: 's/i/m1.jpg', label: 'a.jpg', excluded: false, customerVisible: true, analyzed: false, links: [] }];
    });
    if (url.includes('/storage/v1/object/inspection-media/')) return new Response(new Uint8Array([255, 216, 255]), { headers: { 'content-type': 'image/jpeg' } });
    if (url.startsWith('https://api.anthropic.com')) {
      const b = body as { tool_choice: { type: string } };
      aiBodies.push(b);
      if (b.tool_choice.type === 'tool') return new Response(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'tool_choice: type "tool" and "any" are not supported for this model.' } }), { status: 400 });
      return { content: [{ type: 'thinking', thinking: '…' }, { type: 'text', text: 'Here you go: {"view":"wheel","parts":[{"part":"' + caliper + '","confidence":0.9,"position_certain":true,"condition":"looks_ok","note":"dry","findings":[]}]}' }] };
    }
    return null;
  };
  const r = await aiSort(post('ai-sort', { inspectionId: 'i-4r-now', mediaIds: ['m1'] }));
  assert.equal(r.status, 200);
  assert.deepEqual(aiBodies.map((b) => b.tool_choice.type), ['tool', 'auto']);
  const items = (calls.find((c) => c.url.endsWith('/ai_record_sort'))!.body as { p_items: { parts: { key: string }[] }[] }).p_items;
  assert.equal(items[0].parts[0].key, caliper, 'JSON in a text answer is used when no tool call comes back');
});

// ---------------------------------------------------------------- marketing site: pilot applications and template preview
const pub = (path: string, body: unknown, ip = '1.2.3.4') => new Request(`https://app.test/api/${path}`, {
  method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': ip }, body: JSON.stringify(body) });

test('pilot applications are stored with the service key, emailed with the approval command, and rate limited', async () => {
  respond = (url) => (url.endsWith('/record_pilot_request') ? 'req-1' : { id: 'e1' });
  assert.equal((await pilot(pub('pilot', { shopName: 'A', contactName: 'B', email: 'nope' }))).status, 400);
  const bot = await pilot(pub('pilot', { shopName: 'A', contactName: 'B', email: 'b@a.test', website: 'spam.example' }));
  assert.equal(bot.status, 200);
  assert.ok(!calls.some((c) => c.url.endsWith('/record_pilot_request')), 'honeypot submissions are dropped');
  process.env.PILOT_NOTIFY_EMAIL = 'me@wrynch.test'; process.env.RESEND_API_KEY = 're'; process.env.EMAIL_FROM = 'Wrynch <x@wrynch.test>';
  const r = await pilot(pub('pilot', { shopName: 'Reyes Auto', contactName: 'Dana', email: 'Dana@Reyes.test', techs: '4', notes: 'hi' }));
  assert.equal(r.status, 200);
  const rec = calls.find((c) => c.url.endsWith('/record_pilot_request'))!;
  assert.equal(rec.auth, 'Bearer service');
  assert.deepEqual([(rec.body as { p: Record<string, unknown> }).p.email, (rec.body as { p: Record<string, unknown> }).p.techs], ['dana@reyes.test', 4]);
  const mail = calls.find((c) => c.url.startsWith('https://api.resend.com'))!;
  assert.match((mail.body as { text: string }).text, /approve_pilot_request\('req-1'\)/);
  for (let i = 0; i < 3; i++) await pilot(pub('pilot', { shopName: 'x', contactName: 'y', email: 'y@x.test' }));
  assert.equal((await pilot(pub('pilot', { shopName: 'x', contactName: 'y', email: 'y@x.test' }))).status, 429, 'sixth try in an hour is refused');
  assert.equal((await pilot(pub('pilot', { shopName: 'x', contactName: 'y', email: 'y@x.test' }, '9.9.9.9'))).status, 200, 'other visitors unaffected');
});

test('template preview: reads a PDF with the document block, and refuses when AI is off or the file is wrong', async () => {
  const file = (type: string) => new Request('https://app.test/api/template-read', { method: 'POST', headers: { 'content-type': type }, body: new Uint8Array([37, 80, 68, 70]) });
  assert.equal((await templateRead(file('application/pdf'))).status, 503);
  process.env.ANTHROPIC_API_KEY = 'k';
  respond = (url) => (url.startsWith('https://api.anthropic.com') ? { content: [{ type: 'tool_use', input: { name: 'Shop MPI', points: [
    { stage: 'Under car', name: 'Brakes', detail: 'LF RF LR RR' }, { stage: 'Tires', name: 'LF tire' }] } }] } : null);
  const r = await templateRead(file('application/pdf'));
  assert.equal(r.status, 200);
  assert.deepEqual((await r.json()).points.map((p: { name: string }) => p.name), ['Brakes', 'LF tire']);
  const body = calls.find((c) => c.url.startsWith('https://api.anthropic.com'))!.body as { messages: { content: { type: string }[] }[] };
  assert.equal(body.messages[0].content[0].type, 'document');
  assert.equal((await templateRead(file('application/zip'))).status, 415);
});

test('template mapping: standard points bring their parts and positions; unknown ids and positions are dropped', () => {
  const brakes = buildMappedPoint({ stage: 'Under car', name: 'Brakes' }, { standard: ['S24', 'nope'], extra: [{ classId: 99999 }] });
  assert.deepEqual(brakes.matched, ['Visual brake system condition']);
  const pad = brakes.parts.find((p) => p.label === 'Brake pad')!;
  assert.deepEqual(pad.positions, ['left_front', 'right_front', 'left_rear', 'right_rear']);
  assert.ok(brakes.count >= 8);
  const tire = buildMappedPoint({ stage: 'Tires', name: 'LF tire' }, { standard: [], extra: [{ classId: clsByName('tire').id, positions: ['left_front', 'moon'] }] });
  assert.deepEqual(tire.parts.map((p) => [p.label, p.positions]), [['Tire', ['left_front']]]);
  assert.equal(buildMappedPoint({ stage: 'x', name: 'Customer concern' }, undefined).count, 0);
});

test('template-map calls the model and returns mapped points', async () => {
  process.env.ANTHROPIC_API_KEY = 'k';
  respond = (url) => (url.startsWith('https://api.anthropic.com') ? { content: [{ type: 'tool_use', input: { items: [{ index: 0, standard: ['S24'], extra: [] }, { index: 1, standard: [], extra: [], note: 'Not a part' }] } }] } : null);
  const r = await templateMap(pub('template-map', { points: [{ stage: 'Under car', name: 'Brakes' }, { stage: 'Other', name: 'Customer concern' }] }));
  const out = (await r.json()).points;
  assert.equal(out.length, 2);
  assert.ok(out[0].count > 0);
  assert.deepEqual([out[1].count, out[1].note], [0, 'Not a part']);
});

// ---------------------------------------------------------------- AI note drafts
test('ai-note drafts from confirmed facts, sends confirmed photos, and is never stored', async () => {
  process.env.ANTHROPIC_API_KEY = 'k';
  let reply = 'Brake fluid copper content is 210 ppm and needs attention now; the reservoir checked OK.';
  respond = (url) => {
    if (url.endsWith('/get_inspection')) return bundle((i) => {
      i.media = [{ id: 'm1', sectionId: 'under_hood', url: 's/i/m1.jpg', label: 'a.jpg', excluded: false, customerVisible: true, analyzed: true,
        links: [{ compKey: compKey(clsByName('brake_fluid').id, null), status: 'confirmed', confidence: 0.9 }] }];
    });
    if (url.includes('/storage/v1/object/inspection-media/')) return new Response(new Uint8Array([255, 216, 255]), { headers: { 'content-type': 'image/jpeg' } });
    if (url.startsWith('https://api.anthropic.com')) return { content: [{ type: 'tool_use', input: { text: reply } }] };
    return null;
  };
  const r = await aiNote(post('ai-note', { inspectionId: 'i-4r-now', pointId: 'S14' }));
  const body = await r.json();
  assert.deepEqual([body.source, body.text], ['ai', reply]);
  assert.equal(body.basis.photos, 1);
  const ai = calls.find((c) => c.url.startsWith('https://api.anthropic.com'))!.body as { messages: { content: { type: string; text?: string }[] }[] };
  assert.equal(ai.messages[0].content[0].type, 'image', 'confirmed photo sent to the model');
  assert.match(ai.messages[0].content.at(-1)!.text!, /210 ppm/);
  assert.ok(!calls.some((c) => /set_note|ai_record/.test(c.url)), 'draft is not saved');

  calls = []; reply = 'Brake fluid copper is 350 ppm, flush it.';
  const r2 = await (await aiNote(post('ai-note', { inspectionId: 'i-4r-now', pointId: 'S14' }))).json();
  assert.equal(r2.source, 'rules', 'an invented number falls back to the rules draft');
  assert.match(r2.text, /210 ppm/);
});

test('ai-note needs something rated on the point and an open inspection', async () => {
  respond = (url) => (url.endsWith('/get_inspection') ? bundle((i) => { i.results = []; i.findings = []; i.statuses = []; i.media = []; }) : null);
  assert.equal((await aiNote(post('ai-note', { inspectionId: 'i-4r-now', pointId: 'S14' }))).status, 400);
  respond = (url) => (url.endsWith('/get_inspection') ? bundle((i) => { i.status = 'submitted'; }) : null);
  assert.equal((await aiNote(post('ai-note', { inspectionId: 'i-4r-now', pointId: 'S14' }))).status, 409);
  respond = (url) => (url.endsWith('/get_inspection') ? bundle() : null);
  const r = await (await aiNote(post('ai-note', { inspectionId: 'i-4r-now', pointId: 'S14' }))).json();
  assert.equal(r.source, 'rules', 'without an AI key the rules draft is used');
});

test('links we send point at the shop\'s own address on wrynch.app, and at /app/ elsewhere', () => {
  delete process.env.APP_URL; delete process.env.APP_DOMAIN;
  assert.equal(appRoot(new Request('https://1001.wrynch.app/api/send-report')), 'https://1001.wrynch.app/');
  assert.equal(appRoot(new Request('https://wrynch.app/api/send-report')), 'https://wrynch.app/');
  assert.equal(appRoot(new Request('https://wrynch-rc-1.vercel.app/api/send-report')), 'https://wrynch-rc-1.vercel.app/app/');
  process.env.APP_URL = 'http://localhost:5179';
  assert.equal(appRoot(new Request('http://localhost:5179/api/send-report')), 'http://localhost:5179/app/');
  delete process.env.APP_URL;
});
