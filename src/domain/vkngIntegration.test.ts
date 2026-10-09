import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clsByName, compKey } from './ontology';
import { projectWrynchInspection, syncWrynchInspection, type VkngIntelligencePort, type VkngObservation } from './vkngIntegration';
import type { Inspection, Vehicle } from './types';

const vehicle = { id: 'vehicle-w-1', vin: '1HGCM82633A004352', year: 2003, make: 'Honda', model: 'Accord', trim: 'EX', engine: '2.4L', customer: 'Test Customer', config: {} as Vehicle['config'] } satisfies Vehicle;
const key = compKey(clsByName('brake_pad').id, 'left_front');
const inspection = (status: Inspection['status'] = 'submitted'): Inspection => ({
  id: 'insp-1', ro: 'RO-1', vehicleId: vehicle.id, odometer: 120000, date: '2026-10-08T10:00:00.000Z', technician: 'tech-1', status, concerns: [], dtcs: [],
  results: [{ compKey: key, checkKey: 'brake_pad.lining_thickness', value: 2, rating: 'immediate', at: '2026-10-08T10:00:00.000Z' }],
  findings: [
    { id: 'ai-pending', compKey: key, key: 'worn', severity: 'severe', source: 'ai', status: 'pending', confidence: 0.7, rationale: null, mediaId: 'photo-1', reviewedAt: null, aiOriginal: null },
    { id: 'ai-rejected', compKey: key, key: 'crack', severity: 'severe', source: 'ai', status: 'denied', confidence: 0.8, rationale: null, mediaId: null, reviewedAt: null, aiOriginal: null },
    { id: 'ai-confirmed', compKey: key, key: 'worn', severity: 'severe', source: 'ai', status: 'confirmed', confidence: 0.9, rationale: 'visible wear', mediaId: 'photo-1', reviewedAt: '2026-10-08T10:01:00.000Z', aiOriginal: null },
    { id: 'tech-finding', compKey: key, key: 'wear', severity: 'moderate', source: 'technician', status: 'confirmed', confidence: null, rationale: null, mediaId: null, reviewedAt: '2026-10-08T10:02:00.000Z', aiOriginal: null },
  ],
  media: [{ id: 'photo-1', sectionId: 'brakes', url: 'https://example.invalid/brake.jpg', label: 'Brake pad', excluded: false, customerVisible: true, analyzed: true, links: [{ compKey: key, status: 'confirmed', confidence: 1 }] }],
  observations: [], statuses: [], notes: [], extraComponents: [], customerApprovals: [], estimate: [],
});
const context = (insp: Inspection) => ({ tenantId: 'shop-1', vehicle, inspection: insp, canonicalComponentId: (name: string) => name === 'brake_pad' ? 'vkng:component:brake_pad' : null, inspectionPointId: () => 'brake-inspection-point' });

test('finalized inspection projects confirmed evidence and excludes pending/rejected AI', () => {
  const rows = projectWrynchInspection(context(inspection()));
  assert.equal(rows.length, 3);
  assert.ok(rows.every((row) => row.tenantId === 'shop-1' && row.vehicleId === vehicle.id));
  assert.ok(rows.every((row) => row.component.canonicalComponentId === 'vkng:component:brake_pad' && row.component.position === 'left_front'));
  assert.ok(rows.every((row) => row.reviewStatus === 'confirmed'));
  assert.equal(rows.some((row) => row.id.includes('ai-pending') || row.id.includes('ai-rejected')), false);
  assert.ok(rows.find((row) => row.id.includes('ai-confirmed'))?.evidence.some((item) => item.kind === 'photo'));
});

test('draft inspections and unknown canonical mappings produce no history events', () => {
  assert.deepEqual(projectWrynchInspection(context(inspection('in_progress'))), []);
  assert.deepEqual(projectWrynchInspection({ ...context(inspection()), canonicalComponentId: () => null }), []);
});

test('end-to-end: resolve vehicle, write observations, retrieve component history', async () => {
  const saved: VkngObservation[] = [];
  const port: VkngIntelligencePort = {
    async resolveVehicle(input) { assert.equal(input.wrynchVehicleId, vehicle.id); return { canonicalVehicleId: 'vkng:vehicle:canonical-1', resolution: 'resolved' }; },
    async recordObservation(input) { saved.push(input); return { id: input.id }; },
    async getComponentHistory(input) { return saved.filter((item) => item.tenantId === input.tenantId && item.vehicleId === input.vehicleId && item.component.canonicalComponentId === input.canonicalComponentId); },
  };
  const result = await syncWrynchInspection(context(inspection()), port);
  assert.equal(result.resolution, 'resolved');
  assert.equal(result.canonicalVehicleId, 'vkng:vehicle:canonical-1');
  assert.equal(result.observationIds.length, 3);
  const history = await port.getComponentHistory({ tenantId: 'shop-1', vehicleId: result.canonicalVehicleId!, canonicalComponentId: 'vkng:component:brake_pad' });
  assert.equal(history.length, 3);
  assert.ok(history.every((row) => row.reviewStatus === 'confirmed'));
});

test('conflicted vehicle resolution blocks writes', async () => {
  let writes = 0;
  const port: VkngIntelligencePort = {
    async resolveVehicle() { return { canonicalVehicleId: null, resolution: 'conflicted' }; },
    async recordObservation(input) { writes++; return { id: input.id }; },
    async getComponentHistory() { return []; },
  };
  const result = await syncWrynchInspection(context(inspection()), port);
  assert.equal(result.resolution, 'conflicted');
  assert.equal(result.observationIds.length, 0);
  assert.equal(writes, 0);
});
