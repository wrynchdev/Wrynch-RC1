import test from 'node:test';
import assert from 'node:assert/strict';
import { assessFitment, buildVehicleReasoningContext, confidenceBand } from './vio';

test('VIO confidence bands are deterministic', () => {
  assert.equal(confidenceBand(0.99), 'verified');
  assert.equal(confidenceBand(0.85), 'high');
  assert.equal(confidenceBand(0.65), 'medium');
  assert.equal(confidenceBand(0.25), 'low');
  assert.equal(confidenceBand(null), 'unknown');
});

test('incompatible fitment wins over weaker positive evidence', () => {
  const result = assessFitment(
    { vehicleId: 'v1', configuration: { drivetrain: '4wd' }, installedParts: [], modifications: [], mileage: 100000, asOf: '2026-10-08' },
    [
      { id: 'a', status: 'direct', requirements: {}, exclusions: {}, effects: {}, confidence: 0.9 },
      { id: 'b', status: 'incompatible', requirements: {}, exclusions: { reason: 'clearance' }, effects: {}, confidence: 0.8 },
    ],
  );
  assert.equal(result.status, 'incompatible');
  assert.equal(result.score, 0);
});

test('modification-required fitment carries requirements and effects', () => {
  const result = assessFitment(
    { vehicleId: 'v1', configuration: { lift: 'stock' }, installedParts: [], modifications: [], mileage: 50000, asOf: '2026-10-08' },
    [{
      id: 'r1',
      status: 'modification_required',
      requirements: { levelingKit: '2in+' },
      exclusions: {},
      effects: { possibleRubbing: true },
      confidence: 0.82,
    }],
  );
  assert.equal(result.status, 'modification_required');
  assert.equal(result.requirements[0].levelingKit, '2in+');
  assert.equal(result.effects[0].possibleRubbing, true);
});

test('reasoning context explicitly separates current state from factory data', () => {
  const ctx = buildVehicleReasoningContext({
    vehicleId: 'v1', configuration: { year: 2020, make: 'Ford', model: 'F-150' },
    installedParts: [], modifications: [], mileage: 70000, asOf: '2026-10-08',
  });
  assert.equal(ctx.rules.distinguishFactoryFromCurrentState, true);
  assert.equal(ctx.rules.neverTreatUnknownFitmentAsCompatible, true);
});
