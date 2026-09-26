# Working in this repo

- The ontology workbook in `ontology/` is the source of truth. Change the Python in `ontology/build/`, then run
  `npm run ontology` (app JSON + catalog migration) and `npm run workbook` (xlsx). Never hand-edit
  `src/data/ontology.json` or `supabase/migrations/*_catalog.sql`.
- Class IDs are permanent. Add new classes at the end; never renumber or reuse.
- Units: US customary, except brake friction measurements (pads, shoes, rotor thickness, drum diameter) in mm.
- Immediate Attention (red) = the part no longer meets the minimum legal/OEM standard. Worn-but-legal is Monitor.
- AI output is always a pending proposal. Nothing AI-generated may affect a rating or reach the customer until a
  technician confirms it. Enforced in `src/domain/rating.ts` and, authoritatively, in the database functions in
  `supabase/migrations/` (`ai_record_sort` is server-only; `submit_inspection` refuses while anything is pending).
- Every database write goes through a `security definer` function that checks the caller's shop role. Don't add
  table write policies or grants; add a function and grant it to `authenticated` explicitly.
- Schema changes: add a new migration file; never edit one that may already be applied.
- `src/domain/` stays free of React and browser APIs; tests sit next to it.
- Server code in `server/` uses fetch only (no SDKs) and Web Request/Response handlers.
- Before pushing: `npm test`, `npm run test:db`, `npm run typecheck`, `npm run build` (and `npm run e2e` for UI flow changes).
