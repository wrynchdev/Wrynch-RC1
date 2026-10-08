/**
 * Vehicle Intelligence Ontology (VIO) domain layer.
 *
 * VIO deliberately extends Wrynch's existing inspection ontology instead of
 * replacing it. AUTO/Schema.org/SAREF4AUTO/VSSo/ACES concepts are represented
 * through external mappings; VIO owns the vehicle's changing state and history.
 */

export const VIO_VERSION = '1.0.0';

export type VioNodeType =
  | 'vehicle' | 'vehicle_configuration' | 'system' | 'component' | 'part'
  | 'fitment_rule' | 'modification' | 'maintenance_service' | 'maintenance_record'
  | 'dtc' | 'symptom' | 'diagnostic_test' | 'repair' | 'inspection'
  | 'measurement' | 'trip' | 'observation' | 'source' | 'evidence';

export type VioPredicate =
  | 'HAS_COMPONENT' | 'BELONGS_TO_SYSTEM' | 'FITS' | 'COMPATIBLE_WITH'
  | 'INCOMPATIBLE_WITH' | 'REQUIRES' | 'RECOMMENDS' | 'REPLACES'
  | 'SUPERSEDES' | 'REPLACED_BY' | 'DEPENDS_ON' | 'CAUSES' | 'SYMPTOM_OF'
  | 'DIAGNOSED_BY' | 'REPAIRED_BY' | 'MAINTAINED_BY' | 'MODIFIED_BY'
  | 'INSTALLED_ON' | 'REMOVED_FROM' | 'MEASURED_BY' | 'CONNECTED_TO'
  | 'CONTROLLED_BY' | 'POWERED_BY' | 'USES_FLUID' | 'USES_PART'
  | 'HAS_SPECIFICATION' | 'HAS_MEASUREMENT' | 'HAS_HISTORY' | 'HAS_FINDING'
  | 'HAS_SYMPTOM' | 'HAS_DTC' | 'AFFECTS_FITMENT' | 'OBSERVED_ON';

export type FitmentStatus = 'direct' | 'conditional' | 'modification_required' | 'incompatible' | 'unknown';
export type ConfidenceBand = 'verified' | 'high' | 'medium' | 'low' | 'unknown';

export interface VioSource {
  key: string;
  name: string;
  standardName?: string;
  uri?: string;
}

export interface VioAssertion {
  sourceNodeId: string;
  predicate: VioPredicate;
  targetNodeId: string;
  confidence: number | null;
  sourceKey?: string;
  evidence?: Record<string, unknown>;
  validFrom?: string;
  validTo?: string;
}

export interface ConfigurationState {
  id: string;
  vehicleId: string;
  kind: 'factory' | 'current' | 'historical';
  effectiveFrom: string;
  effectiveTo?: string | null;
  odometer?: number | null;
}

export interface InstalledPart {
  id: string;
  vehicleId: string;
  configurationStateId: string;
  partId: string;
  componentId?: string | null;
  position?: string | null;
  installedAt: string;
  removedAt?: string | null;
  odometerInstalled?: number | null;
  odometerRemoved?: number | null;
}

export interface FitmentRule {
  id: string;
  status: FitmentStatus;
  requirements: Record<string, unknown>;
  exclusions: Record<string, unknown>;
  effects: Record<string, unknown>;
  confidence: number | null;
  sourceKey?: string;
}

export interface VehicleState {
  vehicleId: string;
  configuration: Record<string, unknown>;
  installedParts: InstalledPart[];
  modifications: Array<Record<string, unknown>>;
  mileage: number | null;
  asOf: string;
}

export interface FitmentAssessment {
  status: FitmentStatus;
  score: number;
  confidence: number;
  reasons: string[];
  requirements: Record<string, unknown>[];
  effects: Record<string, unknown>[];
}

const STATUS_SCORE: Record<FitmentStatus, number> = {
  direct: 1,
  conditional: 0.75,
  modification_required: 0.55,
  unknown: 0.25,
  incompatible: 0,
};

export function confidenceBand(value: number | null): ConfidenceBand {
  if (value === null || Number.isNaN(value)) return 'unknown';
  if (value >= 0.95) return 'verified';
  if (value >= 0.8) return 'high';
  if (value >= 0.6) return 'medium';
  if (value > 0) return 'low';
  return 'unknown';
}

/**
 * Evaluate fitment rules against the current vehicle state.
 * This is intentionally deterministic. AI may propose evidence/rules, but it
 * does not become the source of truth.
 */
export function assessFitment(
  state: VehicleState,
  rules: FitmentRule[],
): FitmentAssessment {
  if (!rules.length) {
    return { status: 'unknown', score: 0.25, confidence: 0, reasons: ['No fitment evidence is available.'], requirements: [], effects: [] };
  }

  const applicable = rules.filter((r) => r.status !== 'unknown');
  const incompatible = applicable.filter((r) => r.status === 'incompatible');
  if (incompatible.length) {
    const confidence = Math.max(...incompatible.map((r) => r.confidence ?? 0));
    return {
      status: 'incompatible',
      score: 0,
      confidence,
      reasons: ['At least one applicable source explicitly marks the configuration incompatible.'],
      requirements: incompatible.map((r) => r.exclusions),
      effects: incompatible.map((r) => r.effects),
    };
  }

  const best = [...applicable].sort((a, b) => STATUS_SCORE[b.status] - STATUS_SCORE[a.status])[0];
  const confidence = Math.max(...applicable.map((r) => r.confidence ?? 0));
  const reasons: string[] = [];
  if (best.status === 'direct') reasons.push('A direct fitment relationship exists.');
  if (best.status === 'conditional') reasons.push('Fitment is conditional on vehicle configuration.');
  if (best.status === 'modification_required') reasons.push('A supporting modification is required.');
  if (best.status === 'unknown') reasons.push('Available fitment evidence is inconclusive.');

  return {
    status: best.status,
    score: STATUS_SCORE[best.status],
    confidence,
    reasons,
    requirements: applicable.flatMap((r) => Object.keys(r.requirements).length ? [r.requirements] : []),
    effects: applicable.flatMap((r) => Object.keys(r.effects).length ? [r.effects] : []),
  };
}

/** Create a compact AI context from the digital twin. */
export function buildVehicleReasoningContext(state: VehicleState) {
  return {
    vehicleId: state.vehicleId,
    asOf: state.asOf,
    mileage: state.mileage,
    configuration: state.configuration,
    installedParts: state.installedParts,
    modifications: state.modifications,
    rules: {
      useOntologyRelationships: true,
      requireEvidenceForHighImpactClaims: true,
      distinguishFactoryFromCurrentState: true,
      neverTreatUnknownFitmentAsCompatible: true,
    },
  };
}
