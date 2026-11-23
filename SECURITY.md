# SnapSet Security Audit: Build 3

- **App:** https://noguem05-snapset.onrender.com
- **Audit date:** Sunday, November 22, 2026 (New York time)
- **Who did what:** the builder created the accounts, pasted the keys and approved database writes and paid calls. The coding agent (Claude Code) wrote the fixes and ran the tests below.
- **Status: complete for Build 3**, except a classmate's test run. "PASS" means it was run and the result was seen. Anything else says "OPEN".

## Summary

| Check | Status | Evidence |
| --- | --- | --- |
| No secrets in the repo or its history | PASS | [1](#1-secret-scan) |
| No secrets served by the live site | PASS | [1](#1-secret-scan) |
| `npm audit` | PASS, 0 vulnerabilities | [2](#2-dependency-audit) |
| Database backed up | PASS for the backup. Restore not rehearsed. | [3](#3-backup) |
| Public key can't read the table | PASS | [4](#4-database-lockdown) |
| RLS on every table | PASS: builder ran the SQL check, `logs \| true` (the only table) | [4](#4-database-lockdown) |
| Public key can't insert or delete from a browser console | PASS at 5:28 PM: both `401`, permission denied, database unchanged | [4](#4-database-lockdown) |
| 30 fast calls get 429 (photo route and writes) | PASS on the live site | [5](#5-rate-limits) |
| Faked IP headers don't bypass the limit | PASS on the live site | [5](#5-rate-limits) |
| Two networks get separate limits | PASS: a phone on mobile data loaded normally while the laptop was blocked | [5](#5-rate-limits) |
| Try to break the app | PASS after the fixes | [6](#6-break-it-tests) |
| PostHog events and replay work on the live site | PASS: builder watched the phone visit's replay. Typed code starred out, log-code card hidden. | [7](#7-analytics-privacy) |
| Replay privacy fix | PASS on the live site at 3:52 PM | [7](#7-analytics-privacy) |
| Key redaction in server logs | PASS in tests. Deployed with the 3:51 PM manual deploy of the latest commit (not probed live: that would need a broken key). | [8](#8-what-was-found) |
| Photo ID works on the live site | PASS at 4:53 PM: a leg press photo was identified as Leg Press (Quads, glutes). Two earlier calls returned 502. | [8](#8-what-was-found) |
| Full workflow on a phone | PASS for the builder on mobile data: log code, history, snap and log. A classmate's run is OPEN. | |

## How it is protected

```
phone --> Render (server.js: cookie, limits, validation) --secret key--> Supabase
                                                          --API key-----> OpenRouter
```

- The browser never gets a database key and never calls Supabase. All reads and writes go through the server.
- The table has RLS with no policies, and the public roles have no privileges on it.
- Each browser has a private log. The database stores a SHA-256 hash of its 100-bit code, and every visitor query filters on that hash.
- The cookie is `__Host-`, HttpOnly, Secure and SameSite=Lax.
- Writes from other sites are refused. A Content Security Policy allows only our own scripts and PostHog's.

## 1. Secret scan

Searched for `sk-or-`, `sk-ant-`, `sb_secret_`, `service_role`, key-shaped strings, and the exact values of the OpenRouter key, Supabase secret key, Supabase project ref and owner's log code.

| Where (at commit `ff62342`) | Real secrets | Word matches |
| --- | --- | --- |
| 35 tracked files | 0 | 5 lines, listed below |
| All 21 commits, including the local stash | 0 | The same harmless words |
| Live app, HTML and headers | 0 | 0 |
| Product Page, HTML and headers | 0 | 0 |
| 22 live paths and API routes (at `b30cbba`) | 0 | 0 |

The word matches are not keys:
- `.env.example`: a comment saying what an OpenRouter key starts with.
- `AGENTS.md` and `storage.js`: the name of Supabase's key format.
- `supabase/schema.sql` (2 lines): `service_role` is a database role name, needed in the `grant`.
- This file also matches, because it names the patterns.

`.env` and `data/` were never committed. `/.env`, `/.git/config`, `/server.js`, `/data/logs.json` and path-traversal attempts all return 404. The `phc_` token in the pages is PostHog's public project token.

## 2. Dependency audit

`npm audit` returned `found 0 vulnerabilities`. The app has no npm packages, so there were no high-severity issues to fix. A lockfile was added so the audit can run.

## 3. Backup

- `node scripts/backup-db.js` copies every row to `data/backups/`, which is gitignored because this repo is public.
- Backups were taken before the import (0 rows), after it (12 rows) and during the audit (12 rows).
- The 12 imported rows were compared field by field with the original local log: identical.
- Supabase's free plan has no automatic backups. Restoring from these files has not been rehearsed.
- Backups hold code hashes, not codes, so they can't recover a lost log code.

## 4. Database lockdown

Observed so far:
- The publishable key reading `logs` got `401`, code `42501`, `permission denied for table logs`.
- A request with no key got `401`.
- `logs` is the only table the Data API exposes.

RLS check, in the SQL Editor (every row must be `true`):

```sql
select tablename, rowsecurity from pg_tables where schemaname = 'public';
```

Browser console test. Open a blank tab (`about:blank`), because SnapSet's own security policy blocks calls to Supabase. The delete targets an all-zero test id, so it can't touch a real row. Postgres checks permission before it looks for rows, so it must still be refused.

```js
(async () => {
  const url = prompt("Supabase project URL").trim().replace(/\/+$/, "").replace(/\/rest\/v1$/, "");
  const apikey = prompt("PUBLISHABLE key (starts sb_publishable_)").trim();
  if (!apikey.startsWith("sb_publishable_")) return console.log("Stop: that is not the publishable key.");
  const id = "00000000-0000-0000-0000-000000000000";
  const headers = { apikey, "Content-Type": "application/json" };
  const row = { id, visitor_id: "console-test", machine: "Leg Press", date: "2026-11-22", reps: 1, weight: 1 };
  const show = async (name, res) => console.log(name, res.status, await res.text());
  await show("INSERT", await fetch(`${url}/rest/v1/logs`, { method: "POST", headers, body: JSON.stringify(row) }));
  await show("DELETE", await fetch(`${url}/rest/v1/logs?id=eq.${id}`, { method: "DELETE", headers }));
})();
```

Expected: both print `401` and `permission denied for table logs`.

Result (5:28 PM, Chrome console on `about:blank`, publishable key):

```
INSERT 401 {"code":"42501",…"message":"permission denied for table logs"}
DELETE 401 {"code":"42501",…"message":"permission denied for table logs"}
```

- A backup was taken first. Before and after, the table had the same 12 rows (same SHA-256 fingerprint) and no test row.
- Supabase's error suggests running `GRANT … TO anon`. Don't: the refusal is the intended result.
- The first two runs got `404` because the pasted URL ended in `/rest/v1/`. The snippet above now strips it.

## 5. Rate limits

| Limit | Value |
| --- | --- |
| Photo / AI route | 10 per minute per IP |
| All writes together (log, edit, delete, both code routes) | 20 per minute per IP |
| Reads | 240 per minute per IP |
| Photos, whole app | 300 per day |
| OpenRouter key | $1 total cap, confirmed through OpenRouter's API |

Live results at 3:41 PM:

| Test | Result |
| --- | --- |
| 30 photo calls in 1.5 seconds (invalid images, so free) | 10 × `400`, then 20 × `429` with `Retry-After: 60` |
| 30 edit calls | 20 × `400`, then 10 × `429` |
| Log, delete and both code routes, right after | `429` on all four |
| Reads while writes were blocked | `200` |
| After the limit, faked `X-Forwarded-For`, `X-Real-IP`, `True-Client-IP`, `Forwarded`, `CF-Connecting-IPv6`, `CF-Pseudo-IPv4`, `X-Client-IP` | `429` every time |
| Faked `CF-Connecting-IP` | `403` from Cloudflare |
| Two networks, 5:50 PM: the laptop kept its read limit used up (`429` from 5:50:41, with brief resets each minute) while the builder refreshed on a phone on mobile data | The phone loaded normally both times |

The database fingerprint and OpenRouter usage were the same before and after.

## 6. Break-it tests

| Attack on the live site | Result |
| --- | --- |
| Malformed Host header | 400, still up |
| Path `//` | 404, still up |
| `OPTIONS *` | 400, still up |
| Not JSON, `null` body | 400 |
| Machine `constructor`, weight `1e300`, weight `null`, reps `1e999` | 400 |
| 20 KB "set" | 413 |
| Edit or delete without the owner's cookie | 404 |
| Query-filter injection in id or machine | 404 / 400 |
| Guessed log code | 404 |
| Write from another site | 403 |
| Unsupported method | 404 |
| Read the owner's history without the code | 0 sets (12 with the code) |

The secret scan and the owner-history check were repeated on the 3:51 PM deploy: 0 secrets, same results.

`npm test` runs 43 tests for these rules against a fake database, for free.

## 7. Analytics privacy

- Live test: events (`/i/v0/e/`) and replay (`/s/`) were accepted by PostHog with `200`.
- Inputs are masked, and console, request-body and header capture are off in the page code.
- The log-code card is excluded from capture. Fake codes, shown and typed, were absent from what PostHog captured.
- Retest after the fix was deployed (3:52 PM): a weight typed but not logged was absent from what PostHog captured. Before the fix it was present.
- The builder watched the replay of their own phone visit: the page was recorded, the typed log code showed as stars, and the log-code card showed as "hidden from recording".
- Still visible by design: logged sets on screen in replay, and machine, reps and weight in the `set_logged` event.

## 8. What was found

| # | Severity | Finding | Fix | Status |
| --- | --- | --- | --- | --- |
| 1 | Critical | Anyone could read, edit or delete the only log | A private log per visitor | Live (`886e2ce`) |
| 2 | High | One bad request crashed the server | Safe URL parsing, catch-all handler | Live (`d4dcae0`) |
| 3 | High | No rate limits | Limits per IP and per day | Live (`fa8d298`) |
| 4 | High | Render would wipe the file-based log | Supabase | Live (`886e2ce`) |
| 5 | High | A key pasted with a line break was printed in full in the server log | Check keys before use, redact logs | Deployed (`d10f36a`), verified by tests |
| 6 | High | Evening sets got tomorrow's date on a UTC server | New York dates | Live (`d4dcae0`) |
| 7 | Medium | Bad machines and numbers were saved | Strict validation, database checks | Live (`d4dcae0`) |
| 8 | Medium | The upload limit didn't stop reading | Stop at 4 KB or 2 MB | Live (`d4dcae0`) |
| 9 | Medium | Replay captured typed weight through the Log button's text | Mask the button | Live (`ff62342`), retested |
| 10 | Functional | Photo ID returned 502 on the live site | A typo in `OPENROUTER_MODEL` on Render (`deepseek-v4.1-flas`), found by the builder in Render's logs and corrected. Neither failed call was billed. | Fixed, retested at 4:53 PM |

## Known limits

- **The log code is a password.** Anyone with it can change that log, it can't be revoked, and it can't be recovered.
- **People on one Wi-Fi share a limit**, because limits are per IP.
- **Limits reset on restart**, because they live in memory. The $1 OpenRouter cap is the backstop.
- **Many IPs together** could still fill the free database or use up the day's 300 photos.
- **History shows the newest 1000 sets** per visitor.
- **Third parties:** photos go to OpenRouter and its model providers. PostHog's script runs on the page and is trusted.
- **The OpenRouter key expires on January 26, 2027.**
