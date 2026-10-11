# Wrynch

Digital vehicle inspections recorded down to the **canonical component**: every inspection point maps to parts
(class + position, e.g. `brake_pad @ left_front`), every part is rated OK / Monitor / Immediate Attention by rules
the shop controls, and every part keeps its own history across visits.

**To put it online, follow [SETUP.md](SETUP.md).** Without Supabase settings the app runs as a self-contained demo.

## What it does

- **Technicians** (phone): start an inspection from a VIN, confirm what the vehicle has (drivetrain, brakes,
  powertrain…) so only real parts are checked, shoot each stage in one burst, and let AI place photos on parts and
  suggest findings. They confirm, move or reject every suggestion, type measurements (rated automatically), and
  record why a part couldn't be checked. Finishing is locked until nothing AI-generated is unreviewed.
- **Advisors**: results by rating with last visit's readings, part-by-part history, estimates (parts + labor),
  send the report by text, email or link, reopen for the tech.
- **Customers**: a plain-language phone report with photos and prices showing only technician-confirmed content;
  they approve work from it, no account needed.
- **Owners**: invite the team and set roles, keep several inspection templates (a courtesy check, a brake
  inspection…) with their stages, points, the parts behind each point, when they apply, and which component checks
  each one uses, and set the rating rules. Templates and rules are versioned; past results keep the ones they used.
- **Declined work**: parts a customer saw on a sent report and didn't approve. Parts measured on more than one visit
  get a projected date for reaching the Immediate limit, and the follow-up comes about a month before it; the advisor
  texts the customer a message drafted from the report, marks work booked, or lets it go. Work approved on a later
  visit counts as recovered.
- **EV / hybrid** stage (high-voltage battery, cables, charge port, drive units) appears only on electrified vehicles.

## How it's built

| Path | What |
|---|---|
| `ontology/` | Component ontology workbook (v1.4) and the Python that builds it, `src/data/ontology.json` and the catalog migration. **The workbook is the source of truth.** |
| `src/domain/` | Pure TypeScript: types, template expansion by vehicle, rating rules, AI stand-in, seed data, tests. |
| `src/state/` | `store.ts` (every action; demo or live), `remote.ts` (Supabase auth, database functions, storage over fetch). |
| `src/ui/` | Screens: `tech.tsx`, `advisor.tsx` (advisor, history, rules, customer report), `account.tsx` (sign-in, shop, team, new inspection, template editor), `components.tsx` (component checks per template), `declined.tsx` (declined work), `dashboard.tsx`, `profile.tsx`, `tekmetric.tsx`, `aiKey.tsx`, `training.tsx`, `camera.tsx`. |
| `server/` | `/api` routes, all served by one Vercel function (`routes.ts`): AI sorting, wording and notes, template reading, VIN decode, reports and sending, pilot applications, shop AI keys, Tekmetric, training data. |
| `ios/` | The iPhone/iPad app for technicians (SwiftUI). Its rules come from `src/domain` via `ios/bridge/bridge.ts`; see `ios/README.md`. |
| `training/` | Training script for the part-detection model, using the dataset exported from the labeling screen. |
| `supabase/migrations/` | Schema, row-level security, and the database functions every write goes through. |
| `supabase/tests/` | Database rule tests, a Supabase stand-in for local testing, and its shim. |
| `tests/e2e/` | Browser test of the connected app from sign-up to customer approval. |

### Rules, and where they're enforced

| Rule | App | Database |
|---|---|---|
| R1 a part's rating is the worst of its checks and counted findings | `rating.ts` | — |
| R3 typed measurements rated by the shop's thresholds; AI never measures | `rating.ts` | `set_check` rates on the server |
| R4/R10 AI findings are pending and count for nothing until a tech reviews them | `rating.ts` | only `ai_record_sort` (server key) writes AI output; only `review_finding` confirms it |
| R11 customers see only confirmed findings, confirmed photos marked visible, approved wording | `customerView` | `customer_report` builds the customer's copy |
| R12 no submit while AI findings, photo placements or wording are unreviewed | Finish screen | `submit_inspection` refuses |
| Shop isolation | — | row-level security on every table; no direct table writes |

AI output is validated before it's stored: the part must be one the template lists for that stage on that vehicle,
the finding must be allowed for that part class, and a reworded note is rejected if any number changes.

## Not built yet

Shop-management-system integrations other than Tekmetric, payments, appointment scheduling, push notifications, offline capture,
multi-location reporting, and editing an inspection's template after it has started (it keeps the version it began with).
