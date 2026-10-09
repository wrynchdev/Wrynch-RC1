# VKNG ↔ Wrynch integration

Wrynch now has a server-only adapter for VKNG's Supabase RPC boundary. It does not expose service credentials to the browser or iOS client.

## Request flow

1. A signed-in shop user calls `POST /api/vkng-sync` with `{ "inspectionId": "..." }` and the normal Wrynch bearer token.
2. Wrynch verifies shop access through its existing inspection/export RPCs and derives the tenant ID server-side.
3. Only submitted/sent inspections are projected. Pending or rejected findings and draft inspections are excluded.
4. VKNG resolves a vehicle only from a valid 17-character VIN that exactly matches one canonical VKNG vehicle node. Unknown or duplicate VINs stop the sync.
5. Each observation is upserted under a stable Wrynch observation ID, attached to the VKNG vehicle and component graph, and stored with evidence/provenance. Repeating the request is safe for already-written observations.
6. The endpoint returns the resolution and saved observation IDs. If a partial sync fails, retry the same request; stable IDs make writes idempotent.

## Required deployment configuration

**On VKNG's Supabase project**
- Apply `supabase/migrations/0003_wrynch_integration.sql` after migrations `0001` and `0002`.
- Ensure canonical vehicle nodes exist in `vkng_node` with `node_type = 'vehicle'` and `properties.vin` populated.
- Ensure canonical component/part nodes exist in namespace `vkng` with their stable `external_id` values.

**On Wrynch's server/Vercel project**
- `VKNG_SUPABASE_URL`: VKNG Supabase project URL.
- `VKNG_SUPABASE_SERVICE_ROLE_KEY`: VKNG server-only service/secret key. Never add this to a `VITE_*` variable or a client bundle.
- `VKNG_COMPONENT_MAP_JSON`: JSON object mapping each Wrynch ontology class name to an existing VKNG component/part node's exact `external_id`, for example `{"brake_pad":"<existing-vkng-component-external-id>"}`. Replace the placeholder with a real ID from the VKNG graph; do not guess or create aliases for missing components.

Example request:

```http
POST /api/vkng-sync
Authorization: Bearer <Wrynch user access token>
Content-Type: application/json

{"inspectionId":"<submitted-inspection-id>"}
```

A non-resolved vehicle returns HTTP 409 and writes no observations. Missing credentials or component mappings return a configuration error. An unmapped component is skipped rather than guessed. If no observation is written because all components are unmapped, the response says so.

## Security and limitations

- VKNG credentials are used only by server code and only for RPC calls.
- The tenant is derived from the authorized Wrynch inspection, not accepted from request JSON.
- VKNG's SQL functions enforce tenant-to-vehicle links and restrict their execution to `service_role`.
- Observation writes are idempotent by tenant + Wrynch observation ID. A retry can safely finish a partially completed inspection sync.
- Sending a finalized customer report attempts VKNG sync automatically when all three settings are present. If that attempt fails, report delivery still succeeds and the response marks the VKNG sync as failed; call `POST /api/vkng-sync` to retry. This is not yet a background queue.
- Production still requires applying the VKNG migration, setting real secrets, populating canonical vehicle/component data, configuring the component map, and testing against the actual VKNG Supabase project. The automated tests use a mocked HTTP transport and do not claim live production connectivity.
