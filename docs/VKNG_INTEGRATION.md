# VKNG ↔ Wrynch integration boundary

This feature adds a typed, transport-neutral integration boundary to Wrynch-RC1.

## Flow

1. Wrynch submits an inspection and calls `syncWrynchInspection` with authenticated tenant context, vehicle, inspection, canonical component mapping, and a VKNG adapter port.
2. The port resolves the Wrynch vehicle to a canonical VKNG vehicle. If resolution is ambiguous or lacks evidence, sync stops without writing observations.
3. Only submitted/sent inspections are projected. Check results, technician findings, and explicitly confirmed/modified AI findings are exported; pending/rejected AI suggestions are excluded.
4. Each observation carries tenant scope, component class/position, timestamp, technician attribution, and provenance references. Technician-confirmed linked photos are attached as evidence.
5. The returned observation IDs can be logged against a durable outbox/sync record by the production transport adapter.

## Important limits

- This PR does not add network credentials, change Supabase schema, or deploy anything.
- The caller supplies the canonical component ID mapper; unknown mappings are skipped rather than guessed.
- The end-to-end test uses an in-memory VKNG port. It validates vehicle resolution → observation writes → component-history retrieval, not a live VKNG deployment.
- Production wiring still needs an authenticated server-side adapter, idempotency/outbox persistence, retry/error handling, and a shared canonical ontology mapping. Do not invoke this from a customer browser with secrets.
