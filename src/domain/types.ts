// Core domain types. Names follow the ontology workbook (Data Model sheet).

export type Rating = 'ok' | 'monitor' | 'immediate';
/** Component state shown in the app: a rating, or why there is none. */
export type ComponentState = Rating | 'not_inspected' | 'unable_to_assess' | 'unrated';
export type Severity = 'minor' | 'moderate' | 'severe' | 'critical';
export const SEVERITIES: Severity[] = ['minor', 'moderate', 'severe', 'critical'];

export interface OntologyClass {
  id: number;
  name: string;
  label: string;
  category: string;
  safety: boolean;
  aiPhoto: 'yes' | 'partial' | 'no';
  capture: string;
  positionRule: string;
  positions: string[];
  subtypes: string[];
  checks: string[];
  /** finding key -> default rating at [minor, moderate, severe, critical] */
  findings: Record<string, [Rating, Rating, Rating, Rating]>;
}

export type Op = '<' | '<=' | '>' | '>=';
export interface Check {
  key: string;
  classId: number;
  name: string;
  method: 'visual' | 'functional' | 'measurement' | 'test_equipment' | 'scan_tool' | 'service_interval';
  how: string;
  unit: string | null;
  valueType: 'numeric' | 'categorical' | 'pass_fail' | 'visual';
  bands: { ok: string; monitor: string | null; immediate: string | null };
  /** Present when the app can rate a typed value by itself. */
  auto: { ok: [Op, number]; immediate: [Op, number] | null } | null;
  evidence: string;
  basis: string;
  failFindings: string[];
}

export interface FindingDef { key: string; label: string; definition: string }

export type Condition = string; // predicate id, see ontology.ts CONDITIONS
export interface TemplateComponent { classId: number; position: string | null; required: boolean; when: Condition }
export interface TemplatePoint { id: string; name: string; note: string | null; components: TemplateComponent[] }
export interface TemplateSection { id: string; name: string; points: TemplatePoint[] }
export interface Template { id: string; name: string; sections: TemplateSection[] }

export interface Ontology {
  version: string;
  classes: OntologyClass[];
  checks: Record<string, Check>;
  findings: Record<string, FindingDef>;
  template: Template;
}

// ---------------------------------------------------------------- vehicle & inspection

export interface VehicleConfig {
  powertrain: 'gasoline' | 'diesel' | 'hybrid' | 'plug_in_hybrid' | 'ev';
  drivetrain: 'fwd' | 'rwd' | 'awd' | '4wd';
  transmission: 'automatic' | 'manual';
  rearBrakes: 'disc' | 'drum';
  steering: 'rack' | 'recirc' | 'parallelogram';
  hydraulicSteering: boolean;
  frontSuspension: 'strut' | 'shock';
  rearSuspension: 'shock' | 'strut';
  rearSprings: 'coil' | 'leaf';
  frontCvAxles: boolean;
  independentRearDrive: boolean;
  frontDiff: boolean;
  rearDiff: boolean;
  transferCase: boolean;
  twoPieceDriveshaft: boolean;
  solidAxle: boolean;
  timing: 'belt' | 'chain' | 'none';
  fogLamps: boolean;
  rearWiper: boolean;
  cabinFilter: boolean;
  fuelFilter: boolean;
  /** Where the charge port is (plug-in vehicles only). */
  chargePort: 'left_front' | 'right_front' | 'left_rear' | 'right_rear' | 'front' | 'rear' | null;
}

export interface Vehicle {
  id: string;
  vin: string;
  year: number;
  make: string;
  model: string;
  trim: string;
  engine: string;
  customer: string;
  customerPhone?: string | null;
  customerEmail?: string | null;
  config: VehicleConfig;
}

/** A component on a vehicle: class + position. Stable across inspections. */
export type CompKey = string; // `${classId}@${position ?? ''}`

export interface CheckResult {
  compKey: CompKey;
  checkKey: string;
  value: number | null; // typed measurement (numeric checks)
  rating: Rating;       // computed for numeric auto checks, picked otherwise
  at: string;
}

export type ReviewStatus = 'pending' | 'confirmed' | 'modified' | 'denied';
export interface Finding {
  id: string;
  compKey: CompKey;
  key: string;
  severity: Severity;
  source: 'ai' | 'technician';
  status: ReviewStatus;     // technician findings are 'confirmed' on entry
  confidence: number | null;
  rationale: string | null;
  mediaId: string | null;
  reviewedAt: string | null;
  /** What the AI originally suggested, kept when the tech edits it. */
  aiOriginal: { key: string; severity: Severity } | null;
}

export type LinkStatus = 'ai_proposed' | 'confirmed' | 'technician_added';
/** A part a photo shows. One photo can show several parts, so it appears under every point those parts belong to. */
export interface MediaLink { compKey: CompKey; status: LinkStatus; confidence: number | null }
export interface Media {
  id: string;
  sectionId: string;   // the stage it was taken in
  url: string;
  label: string;
  excluded: boolean;
  customerVisible: boolean;
  analyzed: boolean;   // the AI has looked at it
  links: MediaLink[];
}

/** AI suggestion that a part it saw looks fine. Counts for nothing until a technician confirms it. */
export interface AiObservation {
  id: string;
  mediaId: string;
  compKey: CompKey;
  verdict: 'looks_ok';
  note: string | null;
  confidence: number | null;
  status: 'pending' | 'confirmed' | 'rejected';
}

export type NotInspectedReason =
  | 'not_accessible' | 'not_performed_this_visit' | 'blocked_by_other_condition'
  | 'vehicle_not_road_tested' | 'customer_declined' | 'unsafe_to_inspect';

export interface ComponentStatus {
  compKey: CompKey;
  notInspected: { kind: 'not_inspected' | 'unable_to_assess'; reason: NotInspectedReason } | null;
  override: { rating: Rating; reason: string } | null;
}

export type WordingStatus = 'technician_original' | 'ai_suggested' | 'ai_accepted' | 'ai_edited' | 'ai_rejected';
export interface PointNote {
  pointId: string;
  techText: string;
  aiText: string | null;
  status: WordingStatus;
  customerText: string | null; // what the customer sees once approved
}

export interface EstimateLine {
  id: string;
  compKey: CompKey | null;   // null = general line (shop supplies, diagnosis)
  description: string;
  parts: number;             // dollars
  labor: number;             // dollars
}

export interface Dtc { code: string; description: string; compKey: CompKey | null }

export interface Inspection {
  id: string;
  ro: string;
  vehicleId: string;
  odometer: number;
  date: string; // ISO date
  technician: string;
  status: 'not_started' | 'in_progress' | 'submitted' | 'sent';
  concerns: string[];
  dtcs: Dtc[];
  results: CheckResult[];
  findings: Finding[];
  media: Media[];
  observations: AiObservation[];
  statuses: ComponentStatus[];
  notes: PointNote[];
  extraComponents: CompKey[]; // on-demand components added by the tech (e.g. a warning lamp)
  customerApprovals: CompKey[];
  estimate: EstimateLine[];
  /** Secret token for the customer's report link (server-issued). */
  reportToken?: string | null;
}
