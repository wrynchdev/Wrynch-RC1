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
   | `PILOT_NOTIFY_EMAIL` | your email | where pilot applications are emailed (needs `RESEND_API_KEY` and `EMAIL_FROM`) |

   Without `ANTHROPIC_API_KEY` the app does not guess: photos stay unsorted and techs place them by hand.
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
