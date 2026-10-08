# Wrynch Vehicle Intelligence Ontology (VIO)

VIO is the application/domain layer above Wrynch's existing inspection ontology.

## Standards strategy

VIO does not replace established automotive vocabularies. It maps to them:

- AUTO / Schema.org Automotive: vehicle semantics
- SAREF4AUTO / SOSA concepts: observations and IoT
- VSS/VSSo concepts: vehicle signals
- ACES: aftermarket application/fitment
- OBD/diagnostic vocabularies: DTC semantics

VIO owns the information that is specific to the real, changing vehicle:

1. factory/current/historical configuration
2. installed parts and part history
3. configuration-aware fitment
4. modifications and modification effects
5. maintenance history
6. diagnostic context
7. inspection context
8. usage/telematics observations
9. provenance, evidence and confidence
10. deterministic reasoning context for AI

## Existing Wrynch ontology

The existing component catalog remains authoritative for inspection components, checks, findings and templates. VIO references those entities instead of duplicating them.

## Digital twin model

`vehicle -> configuration_state -> installed_part -> part`

Configuration states are time-bounded. This permits questions such as:

- What was installed when an inspection occurred?
- What changed between two inspections?
- Is a requested part compatible with the current vehicle rather than only its factory configuration?

## Graph model

`vio_relationship` stores semantic edges:

`source -> predicate -> target`

Each edge can carry confidence, source, evidence and validity dates.

Use established predicates before introducing new ones. High-impact assertions should always have provenance.

## Fitment

Fitment is intentionally configuration-aware. A rule can be:

- direct
- conditional
- modification_required
- incompatible
- unknown

Unknown is never treated as compatible.

## AI boundary

AI can propose evidence, findings or relationships, but the ontology/database remains the source of truth. AI context should distinguish:

- factory state
- current state
- historical state
- observed state
- sourced/catalog knowledge
- inferred knowledge

## Next implementation layers

1. VIO RPC/API write/read functions
2. VIN/configuration normalization into VIO state
3. ACES import adapter
4. parts/fitment admin UI
5. vehicle digital-twin UI
6. maintenance/diagnostic graph UI
7. usage/telematics ingestion
8. evidence-backed AI graph queries
