# AGENTS.md — Coding Agent Operating Manual

> Give this file to your coding agent and check that it is using these instructions. Keep the stack, commands, and ground rules current.

## 1. Project Overview
- **What this repo builds:** SnapSet — snap a photo of a gym machine, see what you logged last time on it, and log today's sets/reps/weight.
- **Primary user & core workflow:** [See the living PRD in `docs/index.html`]
- **Tech stack:** Node.js 22 (built-in modules only, no npm packages) / plain HTML+JS page in `public/` / logs saved to `data/logs.json` (gitignored) / photo identification via OpenRouter (`deepseek/deepseek-v4.1-flash` vision model, set by `OPENROUTER_MODEL`). The model must answer with one of the 6 machines in `MACHINES` (`server.js`) or "unknown"; the user can correct it with "Not right? Fix it".

## 2. Commands
- **Install:** install Node.js 22+ (LTS) from nodejs.org, which includes npm. Check with `node -v`. There are no npm packages, so `npm install` isn't needed.
- **Get the code:** `git clone https://github.com/building-with-ai-f26/Noguem05---Snapset.git`, then `cd Noguem05---Snapset`
- **One-time setup:** `Copy-Item .env.example .env`, then put your OpenRouter key after `OPENROUTER_API_KEY=` in `.env` (never commit `.env`)
- **Run locally:** `npm start` → open http://localhost:3000 (stop with Ctrl+C)
- **Run deterministic tests:** `npm test` (no API calls, free)
- **Windows PowerShell:** if `npm` fails with "running scripts is disabled on this system", use `npm.cmd start` and `npm.cmd test` instead (same commands, no policy change needed)
- **Run model evals:** not yet. Manual check so far: 2 Wikimedia Commons photos (leg press, lat pulldown) both identified correctly, ~$0.0002–0.0004 per photo.

## 3. Non-Negotiable Engineering Rules
1. **Plan before coding:** Before touching multiple files, propose a brief plan and wait for approval.
2. **Small batches:** Make small, focused changes that can be reviewed and explained by a human in a single Pull Request.
3. **Explainability:** Avoid unnecessary abstractions or dependencies. Help the human builder understand the main components, what changed, why it matters, what could break, and how it was checked.
4. **Verify changes:** Run relevant checks. For a reproducible logic bug, use a failing test to demonstrate the fix when practical. Record manual checks and known limitations; follow the selected Build 4 evaluation track.
5. **Zero secrets in code:** Never hardcode API keys, tokens, or credentials. Always read from environment variables (`.env`) and update `.env.example` when new variables are needed.
6. **Stop when looping:** If a fix fails twice in a row, stop, summarize what failed, and ask the human before trying a third approach.
