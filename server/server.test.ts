import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { buildMappedPoint, candidatesFor, explainAiError, resetAiState, validateAnalysis } from './ai';
import { mapVpic } from './vin';
import { aiNote, aiSort, aiWording, appRoot, pilot, report, sendReport, status, tekmetricExport, tekmetricImport, tekmetricWebhook, templateMap, templateRead } from './routes';
import { resetTekmetricToken, roIdFromWebhook, toImport } from './tekmetric';
import { aiKey, apiRouter, ROUTES, training, trainingExport, trainingSuggest } from './routes';
import { readFileSync } from 'node:fs';
import { openSecret, sealSecret } from './secrets';
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

test('photos taken from one point are matched only to that point\'s parts', () => {
  const all = candidatesFor(DEFAULT_TEMPLATE, 'under_car', runner.config);
  const point = DEFAULT_TEMPLATE.sections.find((x) => x.id === 'under_car')!.points.find((p) => p.id === 'S24')!;
  const only = candidatesFor(DEFAULT_TEMPLATE, 'under_car', runner.config, 'S24');
  assert.ok(only.length > 0 && only.length < all.length, `${only.length} of ${all.length}`);
  assert.ok(only.every((c) => c.point === point.name));
  assert.equal(candidatesFor(DEFAULT_TEMPLATE, 'under_car', runner.config, null).length, all.length);
});

test('ai-sort offers only parts at the tagged corner for an in-app camera photo', async () => {
  process.env.ANTHROPIC_API_KEY = 'k';
  respond = (url) => {
    if (url.endsWith('/get_inspection')) return bundle((i) => {
      i.media = [{ id: 'm1', sectionId: 'under_car', url: 's/i/m1.jpg', label: 'a.jpg', excluded: false, customerVisible: true, analyzed: false, links: [], corner: 'right_front' }];
    });
    if (url.includes('/storage/v1/object/inspection-media/')) return new Response(new Uint8Array([255, 216, 255]), { headers: { 'content-type': 'image/jpeg' } });
    if (url.startsWith('https://api.anthropic.com')) return { content: [{ type: 'tool_use', input: { parts: [] } }] };
    return null;
  };
  await aiSort(post('ai-sort', { inspectionId: 'i-4r-now', mediaIds: ['m1'] }));
  const body = JSON.stringify(calls.find((c) => c.url.startsWith('https://api.anthropic.com'))!.body);
  assert.match(body, /right front corner/);
  assert.ok(body.includes(compKey(clsByName('brake_rotor').id, 'right_front')));
  assert.ok(!body.includes(compKey(clsByName('brake_rotor').id, 'left_front')), 'other corners are not offered');
});

test('ai-sort sends only the point\'s parts to the model for a point photo', async () => {
  process.env.ANTHROPIC_API_KEY = 'k';
  respond = (url) => {
    if (url.endsWith('/get_inspection')) return bundle((i) => {
      i.media = [{ id: 'm1', sectionId: 'under_car', url: 's/i/m1.jpg', label: 'a.jpg', excluded: false, customerVisible: true, analyzed: false, links: [], pointId: 'S24' }];
    });
    if (url.includes('/storage/v1/object/inspection-media/')) return new Response(new Uint8Array([255, 216, 255]), { headers: { 'content-type': 'image/jpeg' } });
    if (url.startsWith('https://api.anthropic.com')) return { content: [{ type: 'tool_use', input: { parts: [] } }] };
    return null;
  };
  await aiSort(post('ai-sort', { inspectionId: 'i-4r-now', mediaIds: ['m1'] }));
  const body = JSON.stringify(calls.find((c) => c.url.startsWith('https://api.anthropic.com'))!.body);
  assert.match(body, /Visual brake system condition/);
  assert.ok(!/Exhaust/.test(body), 'parts from other points in the stage are not offered');
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
  delete process.env.OPENAI_API_KEY; delete process.env.OPENAI_MODEL; delete process.env.AI_PROVIDER;
  delete process.env.AI_STUB;
  delete process.env.ANTHROPIC_WORKSPACE_ID;
  resetAiState();
  resetRateLimits();
  delete process.env.PILOT_NOTIFY_EMAIL; delete process.env.RESEND_API_KEY; delete process.env.EMAIL_FROM;
  delete process.env.TWILIO_ACCOUNT_SID;
  delete process.env.SHOP_KEYS_SECRET;
  delete process.env.TEKMETRIC_CLIENT_ID; delete process.env.TEKMETRIC_CLIENT_SECRET; delete process.env.TEKMETRIC_ENV;
  resetTekmetricToken();
  calls = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = init?.body && typeof init.body === 'string' ? (() => { try { return JSON.parse(init.body as string); } catch { return init.body; } })() : null;
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
  assert.deepEqual(await (await status(new Request('https://app.test/api/status'))).json(), { ai: false, model: 'off', tekmetric: false, shopKeys: false });
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

test('ai-wording drafts a blank note from confirmed facts in the shop\'s style and stores it as a suggestion', async () => {
  process.env.ANTHROPIC_API_KEY = 'k';
  let style = 'technical';
  respond = (url) => {
    if (url.endsWith('/get_inspection')) return bundle((i) => { i.notes = []; });
    if (url.endsWith('/note_style_for')) return style;
    if (url.startsWith('https://api.anthropic.com')) return { content: [{ type: 'tool_use', input: { text: 'Brake fluid copper content 210 ppm. Needs attention now.' } }] };
    return null;
  };
  const out = await (await aiWording(post('ai-wording', { inspectionId: 'i-4r-now', pointId: 'S14' }))).json();
  assert.equal(out.style, 'technical');
  const ai = calls.find((c) => c.url.startsWith('https://api.anthropic.com'))!.body as { system: string; messages: { content: { text?: string }[] }[] };
  assert.match(ai.system, /shop terminology/);
  assert.match(ai.messages[0].content.at(-1)!.text!, /Confirmed facts/);
  const rec = calls.find((c) => c.url.endsWith('/ai_record_wording'))!;
  assert.equal(rec.auth, 'Bearer service');
  assert.deepEqual(rec.body, { p_inspection: 'i-4r-now', p_point: 'S14', p_text: out.text });
  assert.equal(calls.find((c) => c.url.endsWith('/note_style_for'))!.auth, 'Bearer user-jwt', 'style is read as the user');

  // Customer style, and a model draft with an invented number falls back to the rules draft.
  calls = []; style = 'customer';
  respond = (url) => {
    if (url.endsWith('/get_inspection')) return bundle((i) => { i.notes = []; });
    if (url.endsWith('/note_style_for')) return style;
    if (url.startsWith('https://api.anthropic.com')) return { content: [{ type: 'tool_use', input: { text: 'Copper is 999 ppm.' } }] };
    return null;
  };
  const out2 = await (await aiWording(post('ai-wording', { inspectionId: 'i-4r-now', pointId: 'S14' }))).json();
  assert.ok(!out2.text.includes('999'), out2.text);
  assert.match((calls.find((c) => c.url.startsWith('https://api.anthropic.com'))!.body as { system: string }).system, /not a mechanic/);
  assert.ok(calls.some((c) => c.url.endsWith('/ai_record_wording')));
});

test('ai-wording rewords a written note in the shop\'s style; a blank point with nothing confirmed is refused', async () => {
  process.env.ANTHROPIC_API_KEY = 'k';
  respond = (url) => {
    if (url.endsWith('/get_inspection')) return bundle((i) => { i.notes = [{ pointId: 'S24', techText: 'fronts 5mm rotors grooved', aiText: null, status: 'technician_original', customerText: null }]; });
    if (url.endsWith('/note_style_for')) return 'technical';
    if (url.startsWith('https://api.anthropic.com')) return { content: [{ type: 'tool_use', input: { text: 'Front brake pads measure 5 mm; front rotors are grooved.' } }] };
    return null;
  };
  const out = await (await aiWording(post('ai-wording', { inspectionId: 'i-4r-now', pointId: 'S24' }))).json();
  assert.equal(out.text, 'Front brake pads measure 5 mm; front rotors are grooved.');
  assert.match((calls.find((c) => c.url.startsWith('https://api.anthropic.com'))!.body as { system: string }).system, /professional technical note/);

  respond = (url) => (url.endsWith('/get_inspection') ? bundle((i) => { i.notes = []; i.results = []; i.findings = []; i.statuses = []; i.media = []; }) : null);
  assert.equal((await aiWording(post('ai-wording', { inspectionId: 'i-4r-now', pointId: 'S14' }))).status, 400);
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

// ---------------------------------------------------------------- Tekmetric
const TOKEN = 'b'.repeat(64);
function tekmetric(url: string, body: unknown): unknown {
  if (url.endsWith('/tekmetric_shop_for_token')) return (body as { p_token: string }).p_token === TOKEN ? { shopId: 'shop-1', tekmetricShopId: 238, enabled: true } : null;
  if (url === 'https://sandbox.tekmetric.com/api/v1/oauth/token') return { access_token: 'tm-access', expires_in: 3600 };
  if (url.startsWith('https://sandbox.tekmetric.com/api/v1/repair-orders/55?')) return { id: 55, repairOrderNumber: 10421, vehicleId: 9, customerId: 7, technicianId: 3, milesIn: 88120, customerConcerns: [{ concern: 'Squeal when braking' }] };
  if (url.startsWith('https://sandbox.tekmetric.com/api/v1/repair-orders?')) return { content: [{ id: 55, repairOrderNumber: 10421, vehicleId: 9, customerId: 7, technicianId: 3 }] };
  if (url.startsWith('https://sandbox.tekmetric.com/api/v1/vehicles/9')) return { id: 9, vin: '1hgcm82633a004352', year: 2003, make: 'Honda', model: 'Accord', subModel: 'EX' };
  if (url.startsWith('https://sandbox.tekmetric.com/api/v1/customers/7')) return { id: 7, firstName: 'Pat', lastName: 'Lee', email: 'pat@example.com', phone: [{ number: '555-0111', primary: true }] };
  if (url.startsWith('https://sandbox.tekmetric.com/api/v1/employees/3')) return { id: 3, firstName: 'Ray', lastName: 'K.' };
  if (url.includes('vpic.nhtsa.dot.gov')) return { Results: [{ Make: 'HONDA', Model: 'Accord', ModelYear: '2003', DriveType: 'FWD', BodyClass: 'Sedan' }] };
  if (url.endsWith('/tekmetric_import_ro')) return 'insp-new';
  return null;
}

test('Tekmetric webhook: the repair order is re-read from the API and imported with RO#, vehicle, customer and tech', async () => {
  process.env.TEKMETRIC_CLIENT_ID = 'cid'; process.env.TEKMETRIC_CLIENT_SECRET = 'secret';
  respond = tekmetric;
  const r = await tekmetricWebhook(new Request(`https://app.test/api/tekmetric-webhook?token=${TOKEN}`, { method: 'POST', body: JSON.stringify({ event: 'Repair Order Created', data: { id: 55, repairOrderNumber: 999 } }) }));
  assert.equal((await r.json()).inspectionId, 'insp-new');
  const tokenCall = calls.find((c) => c.url.endsWith('/oauth/token'))!;
  assert.equal(tokenCall.auth, `Basic ${Buffer.from('cid:secret').toString('base64')}`);
  assert.equal(calls.find((c) => c.url.includes('/repair-orders/55'))!.auth, 'Bearer tm-access');
  const imp = calls.find((c) => c.url.endsWith('/tekmetric_import_ro'))!;
  assert.equal(imp.auth, 'Bearer service');
  const ro = (imp.body as { p_shop: string; p_ro: Record<string, unknown> });
  assert.equal(ro.p_shop, 'shop-1');
  assert.deepEqual([ro.p_ro.roId, ro.p_ro.roNumber, ro.p_ro.vin, ro.p_ro.year, ro.p_ro.make, ro.p_ro.trim, ro.p_ro.odometer, ro.p_ro.technician, ro.p_ro.customerName, ro.p_ro.customerPhone],
    [55, '10421', '1HGCM82633A004352', 2003, 'Honda', 'EX', 88120, 'Ray K.', 'Pat Lee', '555-0111']);
  assert.deepEqual(ro.p_ro.concerns, ['Squeal when braking']);
  assert.equal((ro.p_ro.config as { drivetrain: string }).drivetrain, 'fwd', 'vehicle setup comes from the VIN');
  assert.ok(calls.some((c) => c.url.endsWith('/tekmetric_log')));
});

test('Tekmetric webhook: unknown address is refused; without API credentials the notification is logged and skipped', async () => {
  respond = tekmetric;
  assert.equal((await tekmetricWebhook(new Request(`https://app.test/api/tekmetric-webhook?token=${'c'.repeat(64)}`, { method: 'POST', body: '{}' }))).status, 404);
  const r = await tekmetricWebhook(new Request(`https://app.test/api/tekmetric-webhook?token=${TOKEN}`, { method: 'POST', body: JSON.stringify({ event: 'Repair Order Created', data: { id: 55 } }) }));
  assert.equal(r.status, 202);
  const log = calls.find((c) => c.url.endsWith('/tekmetric_log'))!.body as { p_status: string; p_detail: string };
  assert.equal(log.p_status, 'skipped');
  assert.match(log.p_detail, /credentials/);
  assert.ok(!calls.some((c) => c.url.includes('tekmetric.com')), 'nothing is sent to Tekmetric without credentials');
});

test('Tekmetric import by RO number checks the shop link as the user', async () => {
  process.env.TEKMETRIC_CLIENT_ID = 'cid'; process.env.TEKMETRIC_CLIENT_SECRET = 'secret';
  respond = (url, body) => (url.endsWith('/tekmetric_link_for') ? { linked: true, tekmetricShopId: 238, enabled: true } : tekmetric(url, body));
  const r = await tekmetricImport(post('tekmetric-import', { shopId: 'shop-1', roNumber: ' 10421 ' }));
  assert.equal((await r.json()).inspectionId, 'insp-new');
  assert.equal(calls.find((c) => c.url.endsWith('/tekmetric_link_for'))!.auth, 'Bearer user-jwt');
  assert.match(calls.find((c) => c.url.includes('/api/v1/repair-orders?'))!.url, /shop=238&repairOrderNumber=10421/);
});

test('Tekmetric export: only after review, with approved notes, photo counts, estimate decisions and the report link', async () => {
  respond = (url) => {
    if (url.endsWith('/tekmetric_export_info')) return { shopId: 'shop-1', roId: 55, status: 'submitted' };
    if (url.endsWith('/get_inspection')) return bundle((i) => {
      i.status = 'submitted';
      i.notes = [{ pointId: 'S14', techText: 'recommend flush. copper 210 ppm', aiText: 'x', status: 'ai_accepted', customerText: 'Brake fluid tested at 210 ppm copper.' }];
      i.estimate = [{ id: 'e1', compKey: compKey(clsByName('brake_fluid').id, null), description: 'Brake fluid exchange', parts: 24, labor: 95 }];
      i.customerApprovals = [compKey(clsByName('brake_fluid').id, null)];
    });
    return null;
  };
  const out = await (await tekmetricExport(post('tekmetric-export', { inspectionId: 'i-4r-now' }))).json();
  assert.equal(out.written, false);
  assert.match(out.text, /RO 48213/);
  assert.match(out.text, /#\/r\/a{64}/);
  assert.match(out.text, /NEEDS ATTENTION NOW\n- Brake fluid: Brake fluid tested at 210 ppm copper\./);
  assert.match(out.text, /Brake fluid exchange \(Brake fluid\): \$119\.00 · approved by customer/);
  assert.ok(!out.text.includes('recommend flush'), 'the tech shorthand is replaced by the approved note');
  assert.ok(calls.some((c) => c.url.endsWith('/tekmetric_mark_exported')), 'the export time is recorded');

  respond = (url) => (url.endsWith('/tekmetric_export_info') ? { shopId: 'shop-1', roId: 55, status: 'in_progress' } : null);
  assert.equal((await tekmetricExport(post('tekmetric-export', { inspectionId: 'i-4r-now' }))).status, 409);
});

test('Tekmetric webhook bodies: the repair order id is found in common shapes', () => {
  assert.equal(roIdFromWebhook({ event: 'Repair Order Created', data: { id: 12 } }), 12);
  assert.equal(roIdFromWebhook({ event: 'Inspection Complete', data: { id: 5, repairOrderId: 13 } }), 13);
  assert.equal(roIdFromWebhook({ repairOrderId: '14' }), 14);
  assert.equal(roIdFromWebhook({}), null);
  const imp = toImport({ id: 1, repairOrderNumber: 'A1' }, null, { firstName: 'A', lastName: 'B', email: [{ email: 'a@b.c' }] }, null, {} as never);
  assert.deepEqual([imp.roNumber, imp.vin, imp.customerName, imp.customerEmail, imp.technician], ['A1', '', 'A B', 'a@b.c', '']);
});

// ---------------------------------------------------------------- shop AI keys
const MASTER = Buffer.alloc(32, 7).toString('base64');

test('shop keys are sealed with AES-GCM, bound to their shop, and need the server secret', async () => {
  process.env.SHOP_KEYS_SECRET = MASTER;
  const sealed = await sealSecret('sk-test-1234567890abcdefWXYZ', 'shop-1');
  assert.match(sealed, /^v1\./);
  assert.ok(!sealed.includes('sk-test'), 'no plaintext in the stored value');
  assert.equal(await openSecret(sealed, 'shop-1'), 'sk-test-1234567890abcdefWXYZ');
  await assert.rejects(openSecret(sealed, 'shop-2'), /couldn’t be unlocked/, 'a value moved to another shop does not open');
  process.env.SHOP_KEYS_SECRET = Buffer.alloc(32, 8).toString('base64');
  await assert.rejects(openSecret(sealed, 'shop-1'), /couldn’t be unlocked/);
  delete process.env.SHOP_KEYS_SECRET;
  await assert.rejects(sealSecret('x', 'shop-1'), /SHOP_KEYS_SECRET/);
});

test('saving a shop key: owner only, checked with the provider, stored sealed, never sent back', async () => {
  process.env.SHOP_KEYS_SECRET = MASTER;
  const KEY = 'sk-proj-abcdefghijklmnopqrstuvwxyz0123';
  respond = (url) => {
    if (url.endsWith('/assert_shop_owner')) return true;
    if (url === 'https://api.openai.com/v1/models') return { data: [{ id: 'gpt-vision-x' }, { id: 'other' }] };
    if (url.endsWith('/shop_ai_key_info')) return { configured: true, provider: 'openai', model: 'gpt-vision-x', last4: '0123' };
    return null;
  };
  const r = await aiKey(post('ai-key', { shopId: 'shop-1', provider: 'openai', apiKey: ` ${KEY} `, model: 'gpt-vision-x' }));
  const out = await r.json();
  assert.equal(out.last4, '0123');
  assert.ok(!JSON.stringify(out).includes(KEY));
  assert.equal(calls.find((c) => c.url.endsWith('/assert_shop_owner'))!.auth, 'Bearer user-jwt');
  assert.equal(calls.find((c) => c.url === 'https://api.openai.com/v1/models')!.auth, `Bearer ${KEY}`);
  const stored = calls.find((c) => c.url.endsWith('/store_shop_ai_key'))!;
  assert.equal(stored.auth, 'Bearer service');
  const b = stored.body as { p_secret: string; p_last4: string; p_model: string };
  assert.ok(b.p_secret.startsWith('v1.') && !b.p_secret.includes(KEY));
  assert.deepEqual([b.p_last4, b.p_model], ['0123', 'gpt-vision-x']);
  assert.equal(await openSecret(b.p_secret, 'shop-1'), KEY);

  // A key the provider refuses, or a model the key can't use, is not saved.
  calls = [];
  respond = (url) => (url.endsWith('/assert_shop_owner') ? true : url.includes('api.openai.com') ? new Response('{}', { status: 401 }) : null);
  assert.equal((await aiKey(post('ai-key', { shopId: 'shop-1', provider: 'openai', apiKey: KEY, model: 'gpt-vision-x' }))).status, 400);
  respond = (url) => (url.endsWith('/assert_shop_owner') ? true : url.includes('api.openai.com') ? { data: [{ id: 'other' }] } : null);
  assert.equal((await aiKey(post('ai-key', { shopId: 'shop-1', provider: 'openai', apiKey: KEY, model: 'gpt-vision-x' }))).status, 400);
  assert.ok(!calls.some((c) => c.url.endsWith('/store_shop_ai_key')));
  // Not an owner: refused before the key goes anywhere.
  calls = [];
  respond = (url) => (url.endsWith('/assert_shop_owner') ? new Response(JSON.stringify({ message: 'You don\'t have permission' }), { status: 403 }) : null);
  assert.equal((await aiKey(post('ai-key', { shopId: 'shop-1', provider: 'openai', apiKey: KEY, model: 'x' }))).status, 403);
  assert.ok(!calls.some((c) => c.url.includes('openai.com')));
});

test('a shop with its own OpenAI key: photos are sorted through OpenAI with that key, not Wrynch\'s', async () => {
  process.env.SHOP_KEYS_SECRET = MASTER;
  process.env.ANTHROPIC_API_KEY = 'wrynch-key';
  const sealed = await sealSecret('sk-shop-openai-key-1234567890', 'shop-1');
  const rotor = compKey(clsByName('brake_rotor').id, 'left_front');
  respond = (url) => {
    if (url.endsWith('/shop_ai_key_secret')) return { shopId: 'shop-1', provider: 'openai', model: 'gpt-vision-x', secret: sealed };
    if (url.endsWith('/get_inspection')) return bundle((i) => { i.media = [{ id: 'm1', sectionId: 'under_car', url: 's/i/m1.jpg', label: 'a.jpg', excluded: false, customerVisible: true, analyzed: false, links: [] }]; });
    if (url.includes('/storage/v1/object/inspection-media/')) return new Response(new Uint8Array([255, 216, 255]), { headers: { 'content-type': 'image/jpeg' } });
    if (url === 'https://api.openai.com/v1/chat/completions') return { choices: [{ message: { tool_calls: [{ function: { arguments: JSON.stringify({ parts: [{ part: rotor, confidence: 0.9, condition: 'looks_ok', findings: [] }] }) } }] } }] };
    return null;
  };
  const r = await aiSort(post('ai-sort', { inspectionId: 'i-4r-now', mediaIds: ['m1'] }));
  assert.equal((await r.json()).parts, 1);
  const ai = calls.find((c) => c.url === 'https://api.openai.com/v1/chat/completions')!;
  assert.equal(ai.auth, 'Bearer sk-shop-openai-key-1234567890');
  const body = ai.body as { model: string; tools: { function: { name: string } }[]; tool_choice: { function: { name: string } }; messages: { content: { type: string; image_url?: { url: string } }[] }[] };
  assert.equal(body.model, 'gpt-vision-x');
  assert.equal(body.tool_choice.function.name, body.tools[0].function.name);
  assert.ok(body.messages.some((m) => Array.isArray(m.content) && m.content.some((p) => p.type === 'image_url' && p.image_url!.url.startsWith('data:image/jpeg;base64,'))));
  assert.ok(!calls.some((c) => c.url.includes('api.anthropic.com')), 'Wrynch\'s key is not used');
  assert.ok(calls.some((c) => c.url.endsWith('/ai_record_sort')));
});

test('Wrynch\'s own OpenAI key: shops without a key are sorted through OpenAI; AI_PROVIDER picks when both are set', async () => {
  const rotor = compKey(clsByName('brake_rotor').id, 'left_front');
  respond = (url) => {
    if (url.endsWith('/shop_ai_key_secret')) return null;
    if (url.endsWith('/get_inspection')) return bundle((i) => { i.media = [{ id: 'm1', sectionId: 'under_car', url: 's/i/m1.jpg', label: 'a.jpg', excluded: false, customerVisible: true, analyzed: false, links: [] }]; });
    if (url.includes('/storage/v1/object/inspection-media/')) return new Response(new Uint8Array([255, 216, 255]), { headers: { 'content-type': 'image/jpeg' } });
    if (url === 'https://api.openai.com/v1/chat/completions') return { choices: [{ message: { tool_calls: [{ function: { arguments: JSON.stringify({ parts: [{ part: rotor, confidence: 0.9, condition: 'looks_ok', findings: [] }] }) } }] } }] };
    return null;
  };
  process.env.OPENAI_API_KEY = 'sk-wrynch-openai-key-1234567890';
  assert.equal((await (await status(new Request('https://app.test/api/status'))).json()).model, 'gpt-5');
  assert.equal((await (await aiSort(post('ai-sort', { inspectionId: 'i-4r-now', mediaIds: ['m1'] }))).json()).parts, 1);
  const ai = calls.find((c) => c.url === 'https://api.openai.com/v1/chat/completions')!;
  assert.equal(ai.auth, 'Bearer sk-wrynch-openai-key-1234567890');
  assert.equal((ai.body as { model: string }).model, 'gpt-5');
  assert.ok((ai.body as { max_completion_tokens: number }).max_completion_tokens >= 4096, 'room for reasoning models');

  // Both keys set: Anthropic unless AI_PROVIDER says OpenAI.
  process.env.ANTHROPIC_API_KEY = 'k'; process.env.OPENAI_MODEL = 'gpt-vision-x';
  assert.equal((await (await status(new Request('https://app.test/api/status'))).json()).model, 'claude-sonnet-5');
  process.env.AI_PROVIDER = 'openai';
  assert.equal((await (await status(new Request('https://app.test/api/status'))).json()).model, 'gpt-vision-x');
});

// ---------------------------------------------------------------- training data
const get = (name: string) => new Request(`https://app.test/api/${name}`, { headers: { authorization: 'Bearer user-jwt' } });

test('training queue: staff get the next confirmed photos with short-lived links; the database decides who is staff', async () => {
  respond = (url) => {
    if (url.endsWith('/training_queue')) return [{ mediaId: 'm1', path: 's/i/m1.jpg', shop: 1001, vehicle: '2011 Toyota 4Runner', stage: 'under_car', parts: ['71@left_front'] }];
    if (url.endsWith('/training_stats')) return { approved: 3, skipped: 1, waiting: 9, shops: 2, classes: { 71: 3 } };
    if (url.includes('/object/sign/')) return [{ path: 's/i/m1.jpg', signedURL: '/object/sign/inspection-media/s/i/m1.jpg?token=t' }];
    return null;
  };
  const out = await (await training(get('training'))).json();
  assert.equal(out.items[0].url, 'https://db.test/storage/v1/object/sign/inspection-media/s/i/m1.jpg?token=t');
  assert.ok(!('path' in out.items[0]));
  assert.equal(out.stats.waiting, 9);
  assert.equal(calls.find((c) => c.url.endsWith('/training_queue'))!.auth, 'Bearer user-jwt');
  respond = (url) => (url.endsWith('/training_queue') || url.endsWith('/training_stats') ? new Response(JSON.stringify({ message: 'Only Wrynch staff can do that' }), { status: 403 }) : null);
  assert.equal((await training(get('training'))).status, 403);
});

test('training pre-draw: boxes only for the confirmed parts, clamped to the photo, never stored', async () => {
  process.env.ANTHROPIC_API_KEY = 'k';
  const rotor = compKey(clsByName('brake_rotor').id, 'left_front');
  const pad = compKey(clsByName('brake_pad').id, 'left_front');
  respond = (url) => {
    if (url.endsWith('/training_photo')) return { path: 's/i/m1.jpg', parts: [rotor, pad] };
    if (url.includes('/storage/v1/object/inspection-media/')) return new Response(new Uint8Array([255, 216, 255]), { headers: { 'content-type': 'image/jpeg' } });
    if (url.startsWith('https://api.anthropic.com')) return { content: [{ type: 'tool_use', input: { boxes: [
      { part: rotor, x: 0.2, y: 0.3, w: 0.4, h: 0.4 }, { part: pad, x: 0.9, y: 0.9, w: 0.5, h: 0.5 }, { part: '999@x', x: 0, y: 0, w: 0.1, h: 0.1 } ] } }] };
    return null;
  };
  const { boxes } = await (await trainingSuggest(post('training-suggest', { mediaId: 'm1' }))).json();
  assert.equal(boxes.length, 2, 'unknown parts dropped');
  assert.deepEqual([boxes[0].classId, boxes[0].position, boxes[0].source], [clsByName('brake_rotor').id, 'left_front', 'ai']);
  assert.ok(boxes[1].x + boxes[1].w <= 1 && boxes[1].y + boxes[1].h <= 1, 'clamped inside the photo');
  assert.ok(!calls.some((c) => c.url.endsWith('/training_save')));
});

test('training export: a YOLO manifest with signed links, as a download', async () => {
  const rotor = clsByName('brake_rotor').id;
  respond = (url) => {
    if (url.endsWith('/training_export')) return [{ mediaId: 'm1', path: 's/i/m1.jpg', width: 800, height: 600, boxes: [{ classId: rotor, position: 'left_front', x: 0.1, y: 0.2, w: 0.2, h: 0.2, source: 'human' }] }];
    if (url.includes('/object/sign/')) return [{ path: 's/i/m1.jpg', signedURL: '/object/sign/inspection-media/s/i/m1.jpg?token=t' }];
    return null;
  };
  const r = await trainingExport(get('training-export'));
  assert.match(r.headers.get('content-disposition') ?? '', /attachment; filename="wrynch-dataset-/);
  const m = await r.json();
  assert.equal(m.format, 'wrynch-yolo-1');
  assert.deepEqual(m.classes[0].classId, rotor);
  assert.deepEqual(m.images[0].labels, [[0, 0.2, 0.3, 0.2, 0.2]]);
  assert.equal((calls.find((c) => c.url.includes('/object/sign/'))!.body as { expiresIn: number }).expiresIn, 7 * 24 * 3600);
});

// ---------------------------------------------------------------- one function for all routes
test('every route is served through the single router, with its query and body intact', async () => {
  const listed = JSON.parse(/const ROUTE_NAMES = (\[[^\]]*\])/.exec(readFileSync('scripts/build.mjs', 'utf8'))![1].replace(/'/g, '"'));
  assert.deepEqual([...listed].sort(), Object.keys(ROUTES).sort(), 'the build rewrites exactly the routes the router knows');
  assert.equal((await apiRouter(new Request('https://app.test/api/router?route=nope'))).status, 404);
  assert.equal((await apiRouter(new Request('https://app.test/api/router?route=toString'))).status, 404);
  const viaQuery = await apiRouter(new Request('https://app.test/api/router?route=status'));
  assert.equal(viaQuery.status, 200);
  assert.equal(typeof (await viaQuery.json()).ai, 'boolean');
  assert.equal((await apiRouter(new Request('https://app.test/api/status'))).status, 200, 'path form works too');
  // POST bodies reach the route: a pilot application with no fields is refused by the route itself (400), not lost.
  const r = await apiRouter(new Request('https://app.test/api/router?route=pilot', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }));
  assert.equal(r.status, 400);
});
