"""Metadata schema/value updates, data model, rating scale, README text."""
from base import schema_rows, value_rows, dm_rows, log

# ------------------------------------------------------------------ metadata schema
SCHEMA = []
for r in schema_rows:
    r = list(r)
    if r[1] == "ai_finding":
        r[1] = "finding"
    if r[0] == "technician_status":
        r[5] = "Review state of an AI proposal: pending, confirmed, modified or denied. AI findings are not inspection results until confirmed or modified. 'No review occurred' is represented by the absence of a review, not a status."
    if r[0] == "finding_confidence":
        r[3] = "Yes for AI-proposed finding; empty for technician-entered"
    SCHEMA.append(r)
log("Metadata Schema", "severity / finding_confidence scope", "ai_finding", "finding",
    "The entity holds both AI-proposed and technician-entered findings; 'ai_finding' implied AI authorship.")
NEW_SCHEMA = [
    ("rating", "component_rating", "enum", "Yes when component inspected", "Computed from checks + findings; technician override",
     "OK / Monitor / Immediate Attention determination for one component instance in one inspection. See Rating Scale."),
    ("rating_source", "component_rating", "enum", "Yes", "System", "computed or technician_override (override requires a reason)."),
    ("check_result_value", "check_result", "number / enum / pass_fail", "Yes when check performed", "Technician / tool",
     "Measured or observed value for a Condition Check, stored in the check's unit (US customary, except brake friction measurements in mm). Never AI-generated."),
    ("finding_source", "finding", "enum", "Yes", "System", "ai (proposed, needs review) or technician (entered directly)."),
    ("media_assignment_status", "media_assignment", "enum", "Yes", "AI + technician",
     "How a bulk-uploaded photo was attached to an inspection point/component: ai_proposed, confirmed, reassigned, technician_assigned, unassigned, excluded."),
    ("assignment_confidence", "media_assignment", "0-1 float", "Yes for AI assignment", "Photo-mapping model",
     "Confidence that the photo shows the proposed component at the proposed position within the current stage."),
    ("safety_critical", "component_class", "boolean", "Yes", "Catalog",
     "Class affects vehicle safety; drives stricter default ratings in Class Findings."),
    ("ai_photo_assessable", "component_class", "enum", "Yes", "Catalog",
     "yes = condition can be judged from photos; partial = photo supports but a measurement/test decides; no = functional/measured only."),
    ("position_rule_code", "component_class", "enum", "Yes", "Catalog",
     "Machine-readable position rule: none, optional, required, required_if_multiple, required_if_multiple_axles, implied."),
    ("implied_position", "component_class", "enum", "No", "Catalog",
     "Default position filled automatically for implied classes (e.g. trunk_lid → rear); technician may override."),
    ("customer_wording_status", "text_revision", "enum", "Yes when AI wording used", "Technician",
     "technician_original, ai_suggested, ai_accepted, ai_edited, ai_rejected. Customer sees only technician-approved text."),
    ("applies_when", "template_component_mapping", "string", "No", "Template creator",
     "Vehicle-configuration condition for the mapping (e.g. rear drum brakes, EV/PHEV/HEV). Evaluated against VIN decode / technician input."),
]
SCHEMA += [list(x) for x in NEW_SCHEMA]
log("Metadata Schema", "New keys", f"{len(schema_rows)} keys", f"{len(SCHEMA)} keys",
    "Added rating, check results, bulk-photo assignment, finding source, safety/AI flags, position rule code and AI wording status.")

# ------------------------------------------------------------------ metadata values
VALUES = []
for r in value_rows:
    r = list(r)
    if r[0] == "technician_status" and r[1] == "not_reviewed":
        r[2] = "Deprecated: represent 'no review yet' as no review record. Kept for import compatibility."
        r[3] = "deprecated"
        log("Metadata Values", "technician_status.not_reviewed", "active", "deprecated",
            "Conflicted with Data Model (4 statuses). A proposal is pending until reviewed.")
    VALUES.append(r)
ADD = [
    ("position", "bed", "Pickup bed / box area"),
    ("position", "underbody", None),
    ("rating", "ok", "No condition requiring action (minor cosmetic findings may be recorded as OK – noted)."),
    ("rating", "monitor", "Worn/degraded or due, but still meets minimum legal/OEM standards."),
    ("rating", "immediate_attention", "Needs replacing now: no longer performs to minimum legal or OEM standards."),
    ("rating", "not_inspected", "Required component not checked; reason required. Blocks completion when required."),
    ("rating", "not_applicable", "Component not present on this vehicle."),
    ("rating", "unable_to_assess", "Evidence or test insufficient to rate."),
    ("rating_source", "computed", "Derived from check results and confirmed findings."),
    ("rating_source", "technician_override", "Technician changed the computed rating; reason required."),
    ("finding_source", "ai", "Proposed by AI; must be confirmed, modified or denied."),
    ("finding_source", "technician", "Entered by the technician."),
    ("media_assignment_status", "ai_proposed", "AI mapped the photo to a point/component; awaiting technician."),
    ("media_assignment_status", "confirmed", "Technician accepted the AI mapping."),
    ("media_assignment_status", "reassigned", "Technician moved the photo to a different point/component."),
    ("media_assignment_status", "technician_assigned", "Technician attached the photo directly."),
    ("media_assignment_status", "unassigned", "AI could not map the photo with enough confidence; technician must assign or exclude."),
    ("media_assignment_status", "excluded", "Photo not used (duplicate, blurry, irrelevant). Kept, never deleted silently."),
    ("inspection_method", "visual", "Look/photo."),
    ("inspection_method", "functional", "Operate and observe (lamps, horn, wipers, belts, latches)."),
    ("inspection_method", "measurement", "Gauge/tool reading with a unit."),
    ("inspection_method", "test_equipment", "Tester, strip, refractometer, pressure tester."),
    ("inspection_method", "scan_tool", "Diagnostic scan data / codes."),
    ("inspection_method", "service_interval", "Miles/time since service vs OEM schedule."),
    ("ai_photo_assessable", "yes", "Condition can be judged from photos."),
    ("ai_photo_assessable", "partial", "Photo supports; measurement or test decides."),
    ("ai_photo_assessable", "no", "Functional or measured only."),
    ("position_rule_code", "none", "Position not used."),
    ("position_rule_code", "optional", "Position may be recorded."),
    ("position_rule_code", "required", "Position must be recorded."),
    ("position_rule_code", "required_if_multiple", "Required when the vehicle has more than one."),
    ("position_rule_code", "required_if_multiple_axles", "Required when the vehicle has more than one axle location."),
    ("position_rule_code", "implied", "Default position filled automatically; override allowed."),
    ("customer_wording_status", "technician_original", "Technician's own wording."),
    ("customer_wording_status", "ai_suggested", "AI rewrite offered, not yet accepted."),
    ("customer_wording_status", "ai_accepted", "Technician accepted AI wording as-is."),
    ("customer_wording_status", "ai_edited", "Technician edited the AI wording."),
    ("customer_wording_status", "ai_rejected", "Technician kept original."),
]
have = {(r[0], r[1]) for r in VALUES}
for k, v, m in ADD:
    if (k, v) in have:
        continue
    VALUES.append([k, v, m, "active"])
log("Metadata Values", "position.bed", "(missing)", "bed", "'Bed implied' classes had no matching position value.")
log("Metadata Values", "New vocabularies", "8 keys", "rating, rating_source, finding_source, media_assignment_status, inspection_method, ai_photo_assessable, position_rule_code, customer_wording_status",
    "Controlled values for the new workflow fields.")

ADD12 = [
    ("not_inspected_reason", "not_accessible", "Component can't be reached without disassembly (e.g. timing belt behind covers)."),
    ("not_inspected_reason", "not_performed_this_visit", "Check skipped this visit (time, scope, customer request)."),
    ("not_inspected_reason", "blocked_by_other_condition", "Another condition prevents the check (e.g. broken air box)."),
    ("not_inspected_reason", "vehicle_not_road_tested", "Road test not performed (e.g. warning lamp, unsafe, no plates)."),
    ("not_inspected_reason", "customer_declined", "Customer declined this check."),
    ("not_inspected_reason", "unsafe_to_inspect", "Unsafe to inspect (e.g. damaged high-voltage part)."),
    ("service_event_source", "shop_record", "From this shop's repair order/history."),
    ("service_event_source", "customer_reported", "Customer says it was done; unverified."),
    ("service_event_source", "technician_observed", "Evidence seen on the vehicle (sticker, new part)."),
    ("service_event_source", "integration", "Imported from the shop-management system."),
    ("concern_type", "noise", "Abnormal noise reported or found."),
    ("concern_type", "vibration", "Vibration reported or found."),
    ("concern_type", "pull", "Vehicle pulls/drifts."),
    ("concern_type", "powertrain_performance", "Hesitation, stalling, shifting, power loss."),
    ("concern_type", "customer_complaint", "Any other customer-stated concern."),
]
for k, v, m in ADD12:
    VALUES.append([k, v, m, "active"])
SCHEMA += [
    ["not_inspected_reason", "component_rating", "enum", "Yes when rating is not_inspected or unable_to_assess", "Technician", "Coded reason the component wasn't checked (replaces free-text 'not inspected because…')."],
    ["dtc_code", "diagnostic_trouble_code", "string", "Yes for DTC", "Scan tool / technician", "OBD/OEM code (e.g. P0420). Linked to the component(s) it points to; the code alone is not a condition finding."],
    ["service_event_source", "service_event", "enum", "Yes", "Technician / integration", "Where a past-service record came from."],
    ["concern_type", "vehicle_concern", "enum", "Yes", "Technician / customer", "Symptom category for road-test and customer concerns that aren't tied to a component yet."],
]
log("Metadata Values", "New vocabularies", "(none)", "not_inspected_reason, service_event_source, concern_type",
    "The shop's template uses free text for 'not inspected because…', service history ('flushed at 164,149') and road-test symptoms.", "No", "1.2.0")

# ------------------------------------------------------------------ data model
DM = []
for r in dm_rows:
    r = list(r)
    if r[0] == "ai_finding":
        r[0] = "finding"
        if r[1] == "finding_type":
            r[3] = "FK -> condition finding vocabulary; must be allowed for the class (Class Findings)"
    if r[0] == "technician_review" and r[1] == "finding_id":
        r[3] = "FK -> finding"
    if r[0] == "template_inspection_point" and r[1] == "stage_key":
        r = ["template_inspection_point", "stage_id", "UUID", "FK -> template_stage", "Yes", "Template creator", "Stage the point belongs to (replaces free-text stage_key)."]
    DM.append(r)
log("Data Model", "ai_finding", "ai_finding", "finding (+ source, rating fields)", "Holds AI and technician findings; source distinguishes them.")
log("Data Model", "template_inspection_point.stage_key", "optional string", "stage_id FK -> template_stage",
    "Bulk upload happens per stage, so stages must be real records.")
NEW_DM = [
    ("finding", "source", "enum", "", "Yes", "System", "ai or technician."),
    ("finding", "rating", "enum", "", "Yes", "System/technician", "Default from Class Findings by severity; technician may override."),
    ("finding", "technician_text", "string", "", "No", "Technician", "Technician's own description (required when an AI finding is denied and replaced)."),
    ("condition_assessment", "rating", "enum", "", "Yes", "System/technician", "Component rating: worst of check results and confirmed findings (see Rating Scale)."),
    ("condition_assessment", "rating_source", "enum", "", "Yes", "System", "computed / technician_override."),
    ("condition_assessment", "override_reason", "string", "", "When overridden", "Technician", "Why the technician changed the computed rating."),
    ("template_stage", "id", "UUID", "PK", "Yes", "System", "Stage within a template (bulk capture unit)."),
    ("template_stage", "template_id", "UUID", "FK -> template", "Yes", "System", "Parent template."),
    ("template_stage", "name", "string", "", "Yes", "Template creator", "e.g. Under hood."),
    ("template_stage", "capture_instructions", "string", "", "No", "Template creator", "What to shoot in the bulk burst."),
    ("template_stage", "sort_order", "integer", "", "Yes", "Template creator", "Order of stages."),
    ("template_component_mapping", "applies_when", "string", "", "No", "Template creator", "Vehicle-configuration condition (e.g. rear drum brakes)."),
    ("template_component_mapping", "check_keys", "string[]", "FK -> condition_check", "No", "Catalog/template", "Checks to run; defaults to all checks of the class."),
    ("condition_check", "check_key", "string", "PK", "Yes", "Catalog", "e.g. brake_pad.lining_thickness."),
    ("condition_check", "component_class_id", "integer", "FK -> component_class", "Yes", "Catalog", "Class the check applies to."),
    ("condition_check", "method / unit / thresholds", "mixed", "", "Yes", "Catalog / shop override", "See Condition Checks sheet; shops may override thresholds."),
    ("check_result", "id", "UUID", "PK", "Yes", "System", "One performed check on one component instance."),
    ("check_result", "component_instance_id", "UUID", "FK -> component_instance", "Yes", "System", "Component checked."),
    ("check_result", "check_key", "string", "FK -> condition_check", "Yes", "System", "Check performed."),
    ("check_result", "value", "number / enum", "", "Yes", "Technician / tool", "Measured value in the check's unit. Never produced by AI."),
    ("check_result", "rating", "enum", "", "Yes", "System", "OK / Monitor / Immediate from thresholds."),
    ("check_result", "evidence_media_id", "UUID", "FK -> media", "No", "Technician", "Photo of gauge/tester when required."),
    ("media", "id", "UUID", "PK", "Yes", "System", "Uploaded photo/video (original kept; never overwritten)."),
    ("media", "inspection_id", "UUID", "FK -> inspection", "Yes", "System", "Parent inspection."),
    ("media", "stage_id", "UUID", "FK -> template_stage", "Yes", "System", "Stage the bulk upload was made in."),
    ("media", "captured_at / uploaded_at", "timestamp", "", "Yes", "Device/System", "Capture and upload times."),
    ("media_assignment", "id", "UUID", "PK", "Yes", "System", "Link of a photo to a point and component instance."),
    ("media_assignment", "media_id", "UUID", "FK -> media", "Yes", "System", "Photo."),
    ("media_assignment", "inspection_point_id", "UUID", "FK -> inspection point", "When assigned", "AI/technician", "Point within the same stage."),
    ("media_assignment", "component_instance_id", "UUID", "FK -> component_instance", "When assigned", "AI/technician", "Component (class + position)."),
    ("media_assignment", "status", "enum", "", "Yes", "AI/technician", "ai_proposed, confirmed, reassigned, technician_assigned, unassigned, excluded."),
    ("media_assignment", "confidence", "float 0-1", "", "For AI", "Photo-mapping model", "Assignment confidence."),
    ("media_assignment", "previous_assignment_id", "UUID", "FK -> media_assignment", "When reassigned", "System", "History of reassignment; nothing overwritten."),
    ("text_revision", "id", "UUID", "PK", "Yes", "System", "Wording history for a finding/component note."),
    ("text_revision", "technician_text", "string", "", "Yes", "Technician", "Original technician wording (always kept)."),
    ("text_revision", "ai_suggestion", "string", "", "No", "AI", "Customer-friendly rewrite; must not add facts, measurements or repairs."),
    ("text_revision", "customer_text", "string", "", "Yes", "Technician", "Approved text shown to the customer."),
    ("text_revision", "status", "enum", "", "Yes", "Technician", "technician_original, ai_suggested, ai_accepted, ai_edited, ai_rejected."),
]
DM += [list(x) for x in NEW_DM]
NEW_DM12 = [
    ("condition_assessment", "not_inspected_reason", "enum", "", "When not inspected / unable", "Technician", "Coded reason (Metadata Values → not_inspected_reason)."),
    ("diagnostic_trouble_code", "id", "UUID", "PK", "Yes", "System", "A DTC read during the inspection."),
    ("diagnostic_trouble_code", "inspection_id", "UUID", "FK -> inspection", "Yes", "System", "Parent inspection."),
    ("diagnostic_trouble_code", "code / description / status", "string / enum", "", "Yes", "Scan tool / technician", "e.g. P0420, stored/pending/permanent."),
    ("diagnostic_trouble_code", "component_instance_ids", "UUID[]", "FK -> component_instance", "No", "Technician", "Components the code is attributed to (P0128 → thermostat)."),
    ("service_event", "id", "UUID", "PK", "Yes", "System", "Past maintenance on a component (fluid change, flush, replacement)."),
    ("service_event", "vehicle_id / component_class_id / position", "mixed", "FK", "Yes", "Technician / integration", "What was serviced."),
    ("service_event", "odometer / date / source", "integer / date / enum", "", "Odometer or date required", "Technician / integration", "Drives service_interval checks (e.g. transfer case with no records → service_due)."),
    ("vehicle_concern", "id", "UUID", "PK", "Yes", "System", "Symptom from road test or customer (noise, vibration, pull, performance)."),
    ("vehicle_concern", "inspection_id / concern_type / description", "mixed", "", "Yes", "Technician / customer", "What was reported or found."),
    ("vehicle_concern", "linked_component_instance_ids", "UUID[]", "FK -> component_instance", "No", "Technician", "Components the cause was traced to."),
]
DM += [list(x) for x in NEW_DM12]
NEW_DM13 = [
    ("technician_review", "reviewed_by / reviewed_at", "UUID / timestamp", "FK -> user", "Yes when not pending", "System", "Who confirmed, edited or rejected the AI finding, and when. A finding with source = ai is final only when this is set to confirmed or modified."),
    ("finding", "customer_visible", "boolean (derived)", "", "Yes", "System", "True only when source = technician, or source = ai and technician_review.status is confirmed or modified. Pending or denied AI findings are never customer visible."),
    ("media_assignment", "customer_visible", "boolean (derived)", "", "Yes", "System", "True only when status is confirmed, reassigned or technician_assigned, and the technician marked the photo for the customer."),
    ("inspection", "completion_blocked_reasons", "string[] (derived)", "", "System", "System", "Lists every pending AI finding, photo assignment and wording suggestion; completion is refused while any remain."),
]
DM += [list(x) for x in NEW_DM13]
log("Rating Scale", "Rules R10–R12", "(implied by R4)", "Explicit: AI findings final only after tech confirms; nothing unconfirmed reaches the customer; completion blocked while anything AI is pending",
    "Owner requirement: a tech must confirm every AI finding and no unconfirmed finding may reach the customer.", "No", "1.2.0")
log("Data Model", "Confirmation fields", "(none)", "technician_review.reviewed_by/at, finding.customer_visible, media_assignment.customer_visible, inspection.completion_blocked_reasons",
    "Makes the confirmation rule enforceable in the database, not just the UI.", "No", "1.2.0")
log("Data Model", "New entities", "(none)", "diagnostic_trouble_code, service_event, vehicle_concern (+ not_inspected_reason)",
    "Needed to capture the shop's real notes as data instead of free text.", "No", "1.2.0")

# ------------------------------------------------------------------ rating scale
RATING = [
    ("ok", "OK", "Green", "No condition requiring action. Minor cosmetic findings may be recorded as 'OK – noted' so they appear in history.", "Customer: no action needed."),
    ("monitor", "Monitor", "Yellow", "Worn, degraded, due for service, or not working as well as it should — but still meets minimum legal/OEM standards. Includes severe wear that is still above the minimum.", "Customer: recommend; plan replacement."),
    ("immediate_attention", "Immediate Attention", "Red", "Needs replacing now: the component no longer performs to minimum legal or OEM standards (e.g. tread at 2/32, rotor below embossed minimum, inoperative required lamp, play beyond spec, brake/fuel leak).", "Customer: replace now."),
    ("not_inspected", "Not inspected", "Gray", "Required component not checked; reason required. Blocks completion when required.", "Hidden from customer unless shop chooses to show."),
    ("not_applicable", "N/A", "Gray", "Component not on this vehicle (e.g. rear drum on a disc car).", "Hidden."),
    ("unable_to_assess", "Unable to assess", "Gray", "Evidence or test insufficient (e.g. sealed transmission, component hidden).", "Shown with reason."),
]
RULES = [
    ("R1", "Component rating", "A component's rating is the worst of its check results and its confirmed findings (Immediate > Monitor > OK)."),
    ("R2", "Finding rating", "Each confirmed finding takes its default rating from Class Findings for its severity (minor / moderate / severe / critical). Critical is always Immediate Attention."),
    ("R3", "Measurement beats photo", "When a check has a measured value (e.g. pad thickness), its threshold decides; a photo-based estimate cannot override a measurement."),
    ("R4", "AI never decides", "AI proposals (photo mapping, findings, severity, wording) do not affect ratings until the technician confirms or modifies them. Denied proposals are kept for audit, not used."),
    ("R5", "Technician override", "The technician may change any computed rating with a reason; stored as rating_source = technician_override."),
    ("R6", "Point summary", "An inspection point shows the worst rating of its components for convenience; history and timelines are always per component (class + position)."),
    ("R7", "Spec-relative checks", "Checks that compare to a vehicle spec (rotor minimum, torque, ride height) need the spec; if unavailable the technician rates by judgment and the rating_source is technician_override."),
    ("R8", "Shop thresholds", "All thresholds are Wrynch defaults and shop-configurable; the threshold version used is stored with each check result so history stays comparable."),
    ("R9", "Timeline", "History compares the same class + position across inspections. A later OK never implies a repair was done."),
    ("R10", "Tech confirms every AI finding", "An AI finding is final only after a technician confirms it (or edits and accepts it). Until then its review status is pending and it has no effect on ratings, reports or history."),
    ("R11", "Nothing unconfirmed reaches the customer", "Customer-facing reports, share links, exports and the customer portal include only technician-confirmed findings, technician-approved wording, and photos whose assignment the technician confirmed. There is no setting that turns this off."),
    ("R12", "Completion gate", "An inspection cannot be completed while any AI finding, AI photo assignment or AI wording suggestion is still pending. The technician must confirm, edit, reassign or reject each one."),
]

README = [
    ("What this workbook is", "The canonical component ontology for Wrynch: every inspection point maps to one or more components; each component is a class (what part it is) plus a position (where it is on the car); each class carries metadata that decides which checks, findings and ratings are available."),
    ("Hierarchy", "Template → Stage → Inspection point → Component (class + position) → Class metadata → Condition Checks + Class Findings → Rating (OK / Monitor / Immediate Attention)."),
    ("Example", "Point 'Front suspension' (Starter Template, P31) → components LF/RF strut assembly, LF/RF coil spring, LF/RF ball joint, LF/RF control arm, … Each component gets its own rating and its own history over time."),
    ("Bulk capture workflow", "1) Technician shoots all photos for a stage in one burst. 2) AI maps each photo to a point + component within that stage (media_assignment, with confidence) using Classes → Photo capture guidance and the template map. 3) AI proposes findings per photo, limited to the findings allowed for that class. 4) Technician, per point: accept, reassign photos to another point/component, or reject and type their own finding. 5) Technician enters measurements (Condition Checks). Every AI finding stays pending until the technician confirms it; nothing unconfirmed can reach the customer, and the inspection can't be completed while anything AI is pending (Rating Scale R10–R12). 6) Optional: AI rewrites the technician's note in customer-friendly wording; technician approves. 7) Ratings computed per Rating Scale."),
    ("Sheets", "Classes · Class Metadata Map · Metadata Schema · Metadata Values · Condition Findings · Class Findings · Condition Checks · Rating Scale · Starter Template (Stages, Points, Component Map) · Data Model · Change Log · Sources."),
    ("Units", "US customary (32nds of an inch, inches, psi, ft-lb, °F, volts), except brake measurements — pad/shoe lining, rotor thickness and drum diameter — which are in mm, the way techs measure them and how rotor/drum limits are usually stamped."),
    ("Thresholds", "Condition Checks thresholds are Wrynch defaults drawn from industry practice and cited sources; shops can override. Always defer to OEM specifications where they exist."),
    ("IDs", "Class IDs 0–237 are unchanged from release 1.0.0. New classes start at 238 (Added in = 1.1.0). IDs are never reused."),
    ("Release", "1.2.0 — see Change Log for every change and items flagged for your review."),
    ("Shop template", "Sheets 'Shop Template Points' and 'Shop Template Map' map the shop's 34-point MPI to canonical components. 'Example Inspection' runs one real inspection through the model and compares the tech's rating with Wrynch's."),
]
