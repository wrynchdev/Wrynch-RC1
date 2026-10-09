import test from 'node:test';
import assert from 'node:assert/strict';
import { createVkngServerAdapter, parseVkngComponentMap } from './vkngAdapter';

test('component map parser accepts only a string-to-string object', () => {
  assert.deepEqual(parseVkngComponentMap('{"brake_pad":"brake_pad_disc"}'), { brake_pad: 'brake_pad_disc' });
  assert.deepEqual(parseVkngComponentMap(undefined), {});
  assert.throws(() => parseVkngComponentMap('not-json'), /valid JSON/);
  assert.throws(() => parseVkngComponentMap('[]'), /must be an object/);
  assert.throws(() => parseVkngComponentMap('{"brake_pad":3}'), /non-empty string/);
});

test('real adapter sends tenant-scoped RPC calls with server credentials and stable IDs', async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetcher: typeof fetch = async (input, init = {}) => {
    calls.push({ url: String(input), init });
    const url = String(input);
    const payload = JSON.parse(String(init.body)) as Record<string, unknown>;
    if (url.endsWith('/vkng_resolve_wrynch_vehicle')) {
      return new Response(JSON.stringify({ canonicalVehicleId: 'vehicle-uuid', resolution: 'resolved' }), { status: 200 });
    }
    if (url.endsWith('/vkng_record_wrynch_observations')) {
      const observations = payload.p_observations as { id: string }[];
      return new Response(JSON.stringify({ observationIds: observations.map((item) => item.id) }), { status: 200 });
    }
    if (url.endsWith('/vkng_get_wrynch_component_history')) {
      return new Response(JSON.stringify([{ id: 'observation-uuid', tenantId: payload.p_tenant_id }]), { status: 200 });
    }
    return new Response('not found', { status: 404 });
  };
  const adapter = createVkngServerAdapter({
    url: 'https://vkng-project.supabase.co/',
    serviceKey: 'sb_secret_test-only-key',
    componentMap: { brake_pad: 'canonical-brake-pad-node' },
  }, fetcher);

  const resolved = await adapter.resolveVehicle({
    tenantId: 'shop-1', wrynchVehicleId: 'vehicle-w-1', vin: '1HGCM82633A004352',
    year: 2003, make: 'Honda', model: 'Accord', trim: 'EX',
  });
  assert.deepEqual(resolved, { canonicalVehicleId: 'vehicle-uuid', resolution: 'resolved' });
  const saved = await adapter.recordObservation({
    id: 'wrynch:insp-1:result:brake_pad:lining', tenantId: 'shop-1', vehicleId: 'vehicle-uuid',
    component: { canonicalComponentId: 'canonical-brake-pad-node', position: 'left_front' },
    evidence: [{ id: 'result-1', kind: 'inspection_result', recordedAt: '2026-10-08T10:00:00Z', recordedBy: 'tech-1', source: 'wrynch:inspection-result' }],
    reviewStatus: 'confirmed', observedAt: '2026-10-08T10:00:00Z', rating: 'immediate', summary: 'Brake pad lining',
  });
  assert.deepEqual(saved, { id: 'wrynch:insp-1:result:brake_pad:lining' });
  const history = await adapter.getComponentHistory({ tenantId: 'shop-1', vehicleId: 'vehicle-uuid', canonicalComponentId: 'canonical-brake-pad-node' });
  assert.equal(history.length, 1);
  assert.equal(calls.length, 3);
  assert.ok(calls.every((call) => call.url.startsWith('https://vkng-project.supabase.co/rest/v1/rpc/')));
  assert.ok(calls.every((call) => new Headers(call.init.headers).get('apikey') === 'sb_secret_test-only-key'));
  assert.ok(calls.every((call) => !new Headers(call.init.headers).has('authorization')), 'new Supabase secret keys are not sent as bearer tokens');
  const resolveArgs = JSON.parse(String(calls[0].init.body)) as Record<string, unknown>;
  assert.equal(resolveArgs.p_tenant_id, 'shop-1');
  const writeArgs = JSON.parse(String(calls[1].init.body)) as Record<string, unknown>;
  assert.equal((writeArgs.p_observations as { id: string }[])[0].id, 'wrynch:insp-1:result:brake_pad:lining');
  assert.equal(((writeArgs.p_observations as { component: { canonicalComponentId: string } }[])[0]).component.canonicalComponentId, 'canonical-brake-pad-node');
});

test('adapter hides database response bodies and reports missing migration clearly', async () => {
  const adapter = createVkngServerAdapter({
    url: 'https://vkng-project.supabase.co',
    serviceKey: 'server-key',
    componentMap: { brake_pad: 'component-node' },
  }, async () => new Response('sensitive SQL detail', { status: 404 }));
  await assert.rejects(() => adapter.getComponentHistory({
    tenantId: 'shop-1', vehicleId: 'vehicle-uuid', canonicalComponentId: 'component-node',
  }), /Apply VKNG migration 0003_wrynch_integration.sql/);
});
