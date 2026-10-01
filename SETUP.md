# Going live: Supabase + Vercel

About 30 minutes. You need a GitHub account (you have one), a Supabase account and a Vercel account.
Nothing secret ever goes in the code or in chat: keys go only into Supabase's and Vercel's settings pages.

## 1. Create the database (Supabase)

1. Go to supabase.com, create a project. Pick a region near your shop. Save the database password somewhere safe.
2. Load the database. Easiest with the Supabase command-line tool on your computer:
   ```bash
   npx supabase login
   npx supabase link --project-ref YOUR-PROJECT-REF     # the id in your project's URL
   npx supabase db push                                 # runs everything in supabase/migrations
   ```
   No command line? Open **SQL Editor** in Supabase and run every file in `supabase/migrations/` in name order
   (the catalog file is large; paste it in one go). When an update adds a new migration file, run just that file.
3. **Authentication → URL Configuration:** set **Site URL** to your app's address (from step 2 below, e.g.
   `https://wrynch-rc1.vercel.app`) and add the same address under **Redirect URLs**. Email confirmation and
   password-reset links land there; the marketing page at `/` forwards them into the app at `/app/`.
4. **Project Settings → API Keys**, tab **Publishable and secret API keys**: copy the **publishable** key
   (`sb_publishable_…`) and the **secret** key (`sb_secret_…`, click the eye to reveal it). The Project URL is under
   **Project Settings → Data API** (`https://<id>.supabase.co`). The secret key can read everything: it goes only
   into Vercel (server side), never into the app or chat. (The older anon / service_role keys also work until
   Supabase retires them.)

## 2. Host the app (Vercel)

1. Go to vercel.com, **Add New → Project**, import `wrynchdev/Wrynch-RC1`. Framework preset: **Other**. Leave the
   build settings alone (they come from `vercel.json`).
2. Before the first deploy, open **Environment Variables** and add:

   | Name | Value | Needed |
   |---|---|---|
   | `SUPABASE_URL` | Project URL from Supabase | yes |
   | `SUPABASE_ANON_KEY` | publishable key (`sb_publishable_…`) | yes |
   | `SUPABASE_SERVICE_ROLE_KEY` | secret key (`sb_secret_…`) | yes |
   | `APP_URL` | the app's address, e.g. `https://wrynch-rc1.vercel.app` | yes |
   | `ANTHROPIC_API_KEY` | from console.anthropic.com | for real AI photo sorting and wording |
   | `ANTHROPIC_MODEL` | defaults to `claude-sonnet-5` | optional |
   | `ANTHROPIC_WORKSPACE_ID` | Console → Settings → Workspaces (`wrkspc_…`) | only if your key isn't created inside a workspace |
   | `OPENAI_API_KEY` | from platform.openai.com → API keys | instead of `ANTHROPIC_API_KEY`, to use OpenAI |
   | `OPENAI_MODEL` | defaults to `gpt-5`; must read photos | optional |
   | `AI_PROVIDER` | `openai` or `anthropic` | only if both keys are set (otherwise Anthropic is used) |
   | `PILOT_NOTIFY_EMAIL` | your email | where pilot applications are emailed (needs `RESEND_API_KEY` and `EMAIL_FROM`) |

   Without `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` the app does not guess: photos stay unsorted and techs place them by hand.
   To check, open `https://<your-app>/api/status`: `{"ai":true,…}` means real AI sorting is on.
   For the most accurate photo reading, set `ANTHROPIC_MODEL` to `claude-opus-5-5` (higher cost per photo).
   | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM` | from Twilio | to text reports |
   | `RESEND_API_KEY`, `EMAIL_FROM` | from Resend (e.g. `Reyes Auto <reports@yourshop.com>`) | to email reports |

   Without the AI key, photos are sorted by the built-in stand-in so the workflow still works. Without Twilio or
   Resend, advisors copy the report link and send it themselves.
3. Deploy. Vercel builds on every push; the production branch is `main`.
4. Open the app, create your account, then **Set up your shop**. Invite your team from **Settings → Team**.

## 3. Check it's working

- Sign in on a phone, start an inspection, upload a few photos in one stage. They should appear sorted with
  dashed outlines (pending) within a few seconds.
- Finish it, send yourself the report link, open it in a private window: you should see only what you confirmed.

## Costs to expect

Supabase and Vercel both have free tiers that cover a pilot shop; photo storage is what grows. Claude is billed per
photo analyzed. Check each provider's pricing page for current numbers.

## Local development

```bash
cp .env.example .env.local     # fill in your Supabase project (or leave empty for demo mode)
npm install
npm run dev                    # http://localhost:5173 (marketing page), /app/ (the app), with the /api functions
npm test                       # rules, AI guardrails, server functions
npm run test:db                # database permissions and rules (needs PostgreSQL 15+)
npm run e2e                    # full browser run against a local database (needs PostgreSQL + Playwright)
```

## Pilot program

New shops can't sign up on their own. They apply with the form on the home page. Invited teammates can still create
accounts from their invite link, and everyone signs in as usual.

- Each application is saved in the `pilot_request` table. It's emailed to `PILOT_NOTIFY_EMAIL` if that's set up.
- To approve an application, run this in the Supabase SQL editor and send the shop the link it returns:
  `select public.approve_pilot_request('<application id>');`
- The link lets one person create an account and set up the shop. It works once and expires after 30 days.
- If the shop tried the template preview, the mapped template is saved with its application.

## Domains

- **getwrynch.com** is the marketing site. Its `/app` links go to the app.
- **wrynch.app** is the app. Each shop has its own address, made from its shop number: `https://1001.wrynch.app`.
  Signing in on wrynch.app takes you to your shop's address. The sign-in is shared by every wrynch.app address, so it
  carries over. Customer report links use the shop's address.
- Shop numbers start at 1001 and never change (the `number` column on `shop`).

Setup:
1. **Vercel → Project → Settings → Domains:** add `getwrynch.com`, `www.getwrynch.com` (redirect to getwrynch.com),
   `wrynch.app` and `*.wrynch.app`. The wildcard needs wrynch.app to use Vercel's nameservers
   (`ns1.vercel-dns.com`, `ns2.vercel-dns.com`), set at your domain registrar.
2. **Supabase → Authentication → URL Configuration:** Site URL `https://wrynch.app`. Under Redirect URLs, add
   `https://wrynch.app/**` and `https://*.wrynch.app/**`.
3. Optional: `APP_DOMAIN` / `SITE_DOMAIN` environment variables if the domains ever change. They default to wrynch.app and getwrynch.com.

The vercel.app address keeps working as before: the marketing page at `/` and the app at `/app/`.

## Tekmetric

Wrynch connects to Tekmetric as one partner app. Each shop then links its own Tekmetric shop in Wrynch.

1. **Apply for API access** with Tekmetric (their API application form). They review applications and approve
   them at their discretion; expect about 2–3 weeks. You get a client ID and secret, first for their sandbox
   ("practice environment").
2. **Add the credentials in Vercel** (Project → Settings → Environment Variables), then redeploy:
   - `TEKMETRIC_CLIENT_ID` and `TEKMETRIC_CLIENT_SECRET`
   - `TEKMETRIC_ENV` = `sandbox` while testing, `production` for live shops
   Never put these in the code or in chat. Until they're set, Wrynch records Tekmetric notifications but doesn't
   import anything, and Settings says so.
3. **Run the migration** `supabase/migrations/20261005000000_tekmetric.sql` in the Supabase SQL Editor.
4. **Each shop owner, in Wrynch → Settings → Tekmetric:** enters the shop's Tekmetric shop ID and saves. Wrynch
   shows a private webhook address. In Tekmetric they add a webhook (Settings → Integrations) with that address
   and turn on the *Repair Order: Create* event.

What happens then:
- **In:** a new repair order in Tekmetric becomes a Wrynch inspection with the RO number, vehicle (VIN, year,
  make, model, mileage), customer and assigned technician. The vehicle setup is filled in from the VIN for the
  tech to confirm. Anyone in the shop can also pull a repair order by number (Settings, or New inspection).
- **Out:** after review, the advisor clicks **Export to Tekmetric** on the inspection. Wrynch builds the export
  from approved content only: each inspection point's rating and customer note, its photo count, the estimate
  with the customer's decisions, and the report link (where the photos are). Part conditions and history stay
  in Wrynch.

Limits of Tekmetric's API today: it has no inspection endpoints, so Wrynch can't write onto Tekmetric's
inspection points or attach photos there. Its repair-order write calls are documented only to approved
developers, so for now the export is shown as text the advisor copies into the repair order. Once access is
approved and the write calls are confirmed, the export can be sent automatically.

## Shops' own AI keys

Shop owners can use their own Anthropic or OpenAI account (Settings → AI provider). Keys are checked with the
provider, encrypted on the server with AES-256-GCM, and stored so that only the server can read them; people only
ever see the provider, model and last four characters.

1. **Create the encryption secret** once, on your own computer: `openssl rand -base64 32`
2. **Add it in Vercel** as `SHOP_KEYS_SECRET` (Project → Settings → Environment Variables), then redeploy.
   Keep it only there: not in the code, not in chat. Anyone with both this secret and a copy of the database could
   read the keys, so treat it like a password.
3. **Run the migration** `supabase/migrations/20261007000000_shop_ai_keys.sql` in the Supabase SQL Editor.

If `SHOP_KEYS_SECRET` is ever lost or changed, saved keys can no longer be unlocked: owners will see an error and
need to enter their key again. A shop without its own key uses Wrynch's (`OPENAI_API_KEY` or `ANTHROPIC_API_KEY`) as before.

## Training data (part detection)

1. **Run the migration** `supabase/migrations/20261008000000_training.sql`.
2. **Make yourself Wrynch staff** (only staff see **Training data**). In the Supabase SQL Editor:
   `insert into platform_admin (user_id) select id from auth.users where email = 'you@example.com';`
3. Shop owners opt in under **Settings → Help improve Wrynch’s AI** (off by default). Only technician-confirmed
   photos from opted-in shops are offered for labeling, and a shop that turns it off drops out of future exports.
4. Label in **Training data**, then **Export dataset** and train with `training/train.py` (see `training/README.md`).
