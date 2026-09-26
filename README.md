# Wrynch

Digital vehicle inspections recorded down to the **canonical component**: every inspection point maps to
parts (class + position, e.g. `brake_pad @ left_front`), every part is rated OK / Monitor / Immediate
Attention by rules the shop controls, and every part keeps its own history across visits.

This repo is the MVP: a working web app (technician, advisor and customer views), the component ontology it
runs on, and the production database schema.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # rating-rule tests
npm run build      # static build in dist/
```

The demo runs entirely in the browser with seeded data (a 2011 Toyota 4Runner taken from a real shop MPI,
plus three earlier visits so part history has something to show). "Reset demo" in the header restores it.

### Try the flow

1. **Tech → Today → 2011 4Runner.** Road test and under hood are already done, matching the real example.
2. **Under car → Capture → "Use 12 sample photos"** (or pick real photos). The stubbed AI places each photo
   on a part and suggests a few findings. Unsure photos land in *Needs you*.
3. **Review photos:** move any photo, then *Confirm placements*.
4. Open a point (e.g. *Visual brake system condition*): each pad, rotor, caliper and hose has its own row.
   Confirm, edit or reject AI findings; type measurements (pads in mm, tread in 32nds) and the rating is
   computed from the shop's thresholds.
5. Use *Demo: enter the shop's real under-car results* to fill the rest quickly.
6. **Finish:** the button stays locked while any AI finding, photo placement, wording suggestion or required
   part is unresolved. Send to advisor.
7. **Advisor:** results by rating with last-visit values; *Send to customer*.
8. **Customer:** plain-language report with only technician-confirmed content, and approve checkboxes.

## How it's built

| Path | What |
|---|---|
| `ontology/` | The component ontology workbook (v1.2), its v1.0 source, and the Python that builds both the workbook and `src/data/ontology.json`. **The workbook is the source of truth.** |
| `src/data/ontology.json` | Generated: 282 classes, 378 checks, finding applicability and ratings, the shop's 34-point template. Regenerate with `npm run ontology`. |
| `src/domain/` | Pure TypeScript: types, template expansion by vehicle configuration, rating rules, AI stub, seed data, tests. No UI imports. |
| `src/state/store.ts` | In-browser store and all actions (demo persistence in `localStorage`). Replace with API calls. |
| `src/ui/` | React screens: `tech.tsx`, `advisor.tsx` (advisor, vehicle history, rules, customer report). |
| `db/schema.sql` | PostgreSQL schema for the real backend, including views and a trigger that enforce the confirmation rules in the database. |

### Rules the code enforces (ontology "Rating Scale" sheet)

- **R1** A part's rating is the worst of its check results and counted findings.
- **R3** Typed measurements are rated by thresholds; AI never produces a measurement.
- **R4 / R10** AI findings are *pending* until a technician confirms or edits them; pending findings affect nothing.
- **R11** The customer sees only technician-confirmed findings, confirmed photos the tech marked visible, and approved wording.
- **R12** An inspection can't be submitted while anything AI is pending or a required part is unrated.
- Red (**Immediate**) means the part no longer meets the minimum legal or manufacturer standard. Worn but above the minimum is Monitor.

### The AI stub

`src/domain/aiStub.ts` is deterministic so demos and tests repeat. It exposes the two calls a real vision
model will replace: `sortPhotos` (photo → part/position + optional finding, with confidence) and
`suggestWording` (customer rewrite that must keep every number and add none, checked by `wordingKeepsFacts`).
Findings the stub may suggest are limited to those allowed for the class in the ontology.

## Not built yet

Sign-in and shops/users, a real API and photo storage (schema is ready), real vision model, editing templates
and thresholds in the UI (read-only views exist), estimates/pricing, SMS/email delivery, shop-management
integrations, EV stage.
