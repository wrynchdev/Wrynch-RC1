# Working in this repo

- The ontology workbook in `ontology/` is the source of truth. Change the Python in `ontology/build/`, then run
  `npm run ontology` (app JSON) and `npm run workbook` (xlsx). Never hand-edit `src/data/ontology.json`.
- Class IDs are permanent. Add new classes at the end; never renumber or reuse.
- Units: US customary, except brake friction measurements (pads, shoes, rotor thickness, drum diameter) in mm.
- Immediate Attention (red) = the part no longer meets the minimum legal/OEM standard. Worn-but-legal is Monitor.
- AI output is always a pending proposal. Nothing AI-generated may affect a rating or reach the customer until a
  technician confirms it (rules R4, R10–R12 in `src/domain/rating.ts` and the trigger in `db/schema.sql`).
- `src/domain/` stays free of React and browser APIs; put tests next to it (`npm test`).
- Before pushing: `npm test`, `npm run typecheck`, `npm run build`.
