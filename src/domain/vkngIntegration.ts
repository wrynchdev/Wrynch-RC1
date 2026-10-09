/**
 * VKNG integration boundary for Wrynch inspections.
 *
 * This module deliberately has no network or database side effects. The caller must
 * supply the authenticated tenant and a VKNG adapter implementation; production
 * wiring can then persist through VKNG without coupling UI/domain code to transport.
 */
import { cls, parseKey } from './ontology';
import type { CompKey, Finding, Inspection, Vehicle } from './types';

export type VkngEvidenceKind = 'inspection_result' | 'technician_finding' | 'confirmed_ai_finding' | 'photo';
export interface VkngEvidenceReference {
  id: string;
  kind: VkngEvidenceKind;
  recordedAt: string;
  recordedBy: string;
  source: string;
  uri?: string;
}
export interface VkngObservation {
  id: string;
  tenantId: string;
  vehicleId: string;
  component: { canonicalComponentId: string; position?: string };
  evidence: VkngEvidenceReference[];
  reviewStatus: 'confirmed';
  observedAt: string;
  inspectionPointId?: string;
  rating?: 'ok' | 'monitor' | 'immediate';
  summary: string;
}
export interface VkngVehicleReference {
  wrynchVehicleId: string;
  vin: string;
  year: number;
  make: string;
  model: string;
  trim: string;
}
export interface VkngIntelligencePort {
  resolveVehicle(input: VkngVehicleReference): Promise<{ canonicalVehicleId: string | null; resolution: 'resolved' | 'insufficient_evidence' | 'conflicted' }>;
  recordObservation(input: VkngObservation): Promise<{ id: string }>;
  getComponentHistory(input: { tenantId: string; vehicleId: string; canonicalComponentId: string }): Promise<VkngObservation[]>;
}

export interface WrynchVkngContext {
  tenantId: string;
  vehicle: Vehicle;
  inspection: Inspection;
  /** Must map the local ontology class to VKNG's stable canonical component identity. */
  canonicalComponentId(className: string): string | null;
  /** Optional mapping from a point id to the inspection point identity in VKNG. */
  inspectionPointId?: (compKey: CompKey) => string | undefined;
}

function approvedFinding(finding: Finding): boolean {
  return finding.source === 'technician'
    ? finding.status !== 'denied'
    : finding.status === 'confirmed' || finding.status === 'modified';
}

/**
 * Projects only finalized, reviewed observations. Pending/rejected AI content and
 * draft inspections are intentionally never sent into component history.
 */
export function projectWrynchInspection(context: WrynchVkngContext): VkngObservation[] {
  const { tenantId, vehicle, inspection } = context;
  if (!tenantId.trim()) throw new Error('tenantId is required');
  if (inspection.status !== 'submitted' && inspection.status !== 'sent') return [];

  const observations: VkngObservation[] = [];
  for (const result of inspection.results) {
    const { classId, position } = parseKey(result.compKey);
    const canonicalComponentId = context.canonicalComponentId(cls(classId).name);
    if (!canonicalComponentId) continue;
    observations.push({
      id: `wrynch:${inspection.id}:result:${result.compKey}:${result.checkKey}`,
      tenantId, vehicleId: vehicle.id,
      component: { canonicalComponentId, ...(position ? { position } : {}) },
      evidence: [{ id: `result:${inspection.id}:${result.compKey}:${result.checkKey}`, kind: 'inspection_result',
        recordedAt: result.at, recordedBy: inspection.technician, source: 'wrynch:inspection-result' }],
      reviewStatus: 'confirmed', observedAt: result.at,
      ...(context.inspectionPointId?.(result.compKey) ? { inspectionPointId: context.inspectionPointId(result.compKey) } : {}),
      rating: result.rating, summary: `Check ${result.checkKey}: ${result.rating}`,
    });
  }

  for (const finding of inspection.findings.filter(approvedFinding)) {
    const { classId, position } = parseKey(finding.compKey);
    const canonicalComponentId = context.canonicalComponentId(cls(classId).name);
    if (!canonicalComponentId) continue;
    const media = finding.mediaId ? inspection.media.find((item) => item.id === finding.mediaId) : undefined;
    const evidence: VkngEvidenceReference[] = [{
      id: `finding:${inspection.id}:${finding.id}`,
      kind: finding.source === 'technician' ? 'technician_finding' : 'confirmed_ai_finding',
      recordedAt: finding.reviewedAt ?? inspection.date, recordedBy: inspection.technician,
      source: `wrynch:${finding.source}-finding`,
    }];
    if (media && !media.excluded && media.links.some((link) => link.compKey === finding.compKey && link.status !== 'ai_proposed')) {
      evidence.push({ id: `media:${media.id}`, kind: 'photo', recordedAt: inspection.date,
        recordedBy: inspection.technician, source: 'wrynch:technician-confirmed-media', uri: media.url });
    }
    observations.push({
      id: `wrynch:${inspection.id}:finding:${finding.id}`, tenantId, vehicleId: vehicle.id,
      component: { canonicalComponentId, ...(position ? { position } : {}) }, evidence,
      reviewStatus: 'confirmed', observedAt: finding.reviewedAt ?? inspection.date,
      ...(context.inspectionPointId?.(finding.compKey) ? { inspectionPointId: context.inspectionPointId(finding.compKey) } : {}),
      summary: `${finding.key} (${finding.severity})`,
    });
  }
  return observations;
}

/** Send the projected inspection into VKNG; return persisted IDs for audit/logging. */
export async function syncWrynchInspection(
  context: WrynchVkngContext,
  vkng: VkngIntelligencePort,
): Promise<{ canonicalVehicleId: string | null; resolution: 'resolved' | 'insufficient_evidence' | 'conflicted'; observationIds: string[] }> {
  const { vehicle } = context;
  const resolution = await vkng.resolveVehicle({
    wrynchVehicleId: vehicle.id, vin: vehicle.vin, year: vehicle.year, make: vehicle.make, model: vehicle.model, trim: vehicle.trim,
  });
  if (resolution.resolution !== 'resolved' || !resolution.canonicalVehicleId) {
    return { canonicalVehicleId: resolution.canonicalVehicleId, resolution: resolution.resolution, observationIds: [] };
  }
  const projected = projectWrynchInspection(context);
  const ids: string[] = [];
  for (const observation of projected) {
    const saved = await vkng.recordObservation({ ...observation, vehicleId: resolution.canonicalVehicleId });
    ids.push(saved.id);
  }
  return { canonicalVehicleId: resolution.canonicalVehicleId, resolution: resolution.resolution, observationIds: ids };
}
