# AGENTS.md — Coding Agent Operating Manual

> Give this file to your coding agent and check that it is using these instructions. Keep the stack, commands, and ground rules current.

## 1. Project Overview
- **What this repo builds:** SnapSet — snap a photo of a gym machine, see what you logged last time on it, and log today's sets/reps/weight.
- **Primary user & core workflow:** [See the living PRD in `docs/index.html`]
- **Tech stack:** Node.js 22 (built-in modules only, no npm packages) / plain HTML+JS page in `public/` / hosted on Render / logs in Supabase, reached only by the server / photo identification via OpenRouter (`deepseek/deepseek-v4.1-flash` vision model, set by `OPENROUTER_MODEL`). The model must answer with one of the 6 machines in `MACHINES` (`server.js`) or "unknown"; the user can correct it with "Not right? Fix it".
- **Main parts:**
  - `server.js`: routes, validation, workout math, the AI call
  - `storage.js`: every database call. Uses the secret key, so every visitor query must filter by `visitor_id`.
  - `visitor.js`: one private log per browser (cookie), plus the log code that opens it on another device
  - `security.js`: rate limits, cross-site check, security headers
  - `supabase/schema.sql`: the database. RLS on, no policies, no access for the public key.

## 2. Commands
- **Install:** install Node.js 22+ (LTS) from nodejs.org, which includes npm. Check with `node -v`. There are no npm packages, so `npm install` isn't needed.
- **Get the code:** `git clone https://github.com/building-with-ai-f26/Noguem05---Snapset.git`, then `cd Noguem05---Snapset`
- **One-time setup:** `Copy-Item .env.example .env`, then fill in `OPENROUTER_API_KEY`, `SUPABASE_URL` and `SUPABASE_SECRET_KEY` in `.env` (never commit `.env`)
- **Run locally:** `npm start` → open http://localhost:3000 (stop with Ctrl+C)
- **Careful:** `npm start` with a filled `.env` uses the REAL database. Sets you log or delete locally are real.
- **Run deterministic tests:** `npm test` (fake Supabase, no API calls, free, never touches real data)
- **Dependency audit:** `npm audit`
- **Back up the database:** `node scripts/backup-db.js` (read-only, saves to gitignored `data/backups/`)
- **Import the old local log:** `node scripts/import-logs.js` previews. `--confirm` writes: ask first.
- **Windows PowerShell:** if `npm` fails with "running scripts is disabled on this system", use `npm.cmd start` and `npm.cmd test` instead (same commands, no policy change needed)
- **Run model evals:** not yet. Manual check so far: 2 Wikimedia Commons photos (leg press, lat pulldown) both identified correctly, ~$0.0002–0.0004 per photo.

## 3. Non-Negotiable Engineering Rules
1. **Plan before coding:** Before touching multiple files, propose a brief plan and wait for approval.
2. **Small batches:** Make small, focused changes that can be reviewed and explained by a human in a single Pull Request.
3. **Explainability:** Avoid unnecessary abstractions or dependencies. Help the human builder understand the main components, what changed, why it matters, what could break, and how it was checked.
4. **Verify changes:** Run relevant checks. For a reproducible logic bug, use a failing test to demonstrate the fix when practical. Record manual checks and known limitations; follow the selected Build 4 evaluation track.
5. **Zero secrets in code:** Never hardcode API keys, tokens, or credentials. Always read from environment variables (`.env`) and update `.env.example` when new variables are needed.
6. **Stop when looping:** If a fix fails twice in a row, stop, summarize what failed, and ask the human before trying a third approach.
7. **Never let a test wait forever:** give every browser and network step a timeout. Test uploads with an image made inside the page, not the file picker. *(Real mistake, Build 2 on 2026-11-15: the agent's browser test froze at the step that attached a photo and had to be stopped.)*
8. **Live-only failures:** When something works locally but fails on the live site, check the Render logs first, and double-check environment variable values for typos.

## 4. Ask Me First
Stop and get the human's explicit OK, each time, before:
1. **Deleting data or changing the database:** deleting or editing real rows (test rows included), imports, restores, running SQL, schema changes. Back up first.
2. **Keys, secrets and permissions:** creating, moving, rotating or revoking keys, changing environment variables, RLS, grants, or repo/service access. The human pastes secret values; never print them or ask for them in chat.
3. **Anything that costs money:** paid plans, adding a card, raising a spend cap, real AI calls (even one photo), new paid services.

## 5. Deploy

### Database (once)
1. Supabase → New project: Free plan, East US, Data API on, auto-expose new tables off, automatic RLS on.
2. SQL Editor → paste `supabase/schema.sql` → Run. The result must show `logs` with `rowsecurity = true`.

### Render (once)
1. New → Web Service → connect this GitHub repo. If the org blocks Render's GitHub app, use **Public Git Repository** with the repo URL.
2. Settings:

| Setting | Value |
| --- | --- |
| Language | Node |
| Branch | `main` |
| Region | Virginia |
| Build Command | `npm install` |
| Start Command | `npm start` |
| Instance Type | Free |
| Health Check Path | `/healthz` |

3. Environment (the human pastes the values):

| Key | Value |
| --- | --- |
| `OPENROUTER_API_KEY` | secret, same as `.env` |
| `OPENROUTER_MODEL` | `deepseek/deepseek-v4.1-flash` |
| `SUPABASE_URL` | the project URL |
| `SUPABASE_SECRET_KEY` | secret, starts `sb_secret_`. Never the publishable key. |
| `NODE_VERSION` | `22` |

Don't set `PORT` or `RENDER`: Render sets both. `RENDER=true` turns on secure cookies and real visitor IPs.

### Every release
1. `npm test` and `npm audit`, then commit and push `main`.
2. A connected repo deploys by itself. A Public Git Repository service does not: click **Manual Deploy → Deploy latest commit**.
3. Check that `/healthz` returns `{"ok":true}`, then log one set from a phone.

### If it breaks
- **Bad release:** Render → Events → last good deploy → Rollback. The database is not rolled back.
- **Slow first load:** the free service sleeps after 15 idle minutes and takes about a minute to wake.
- **Saving fails:** check Render's logs, then whether Supabase paused the project (about a week of low activity).
- **Leaked key:** revoke it at the provider first (ask first), then replace it in `.env` and Render.
