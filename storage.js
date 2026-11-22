// SnapSet's database calls. Only the server uses this file: it holds the secret key,
// which skips Row Level Security, so every query for a visitor MUST filter by visitor_id.
// Talks to Supabase's REST API with built-in fetch (no packages).

const { cleanKey } = require("./security.js");

const COLUMNS = "id,machine,date,sets,reps,weight"; // never send visitor_id to the browser
const MAX_ROWS = 1000; // Supabase returns at most 1000 rows per request

function createStorage(url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SECRET_KEY) {
  const configured = Boolean(url && key);

  async function request(method, params, body) {
    if (!configured) throw new Error("SUPABASE_URL or SUPABASE_SECRET_KEY is missing.");
    const apikey = cleanKey("SUPABASE_SECRET_KEY", key);
    const endpoint = new URL("/rest/v1/logs", url);
    endpoint.search = new URLSearchParams(params);
    const res = await fetch(endpoint, {
      method,
      signal: AbortSignal.timeout(10000),
      // New-style sb_secret_ keys go in apikey, not in Authorization
      headers: { apikey, "Content-Type": "application/json", Prefer: "return=representation" },
      body: body && JSON.stringify(body),
    });
    if (!res.ok) {
      // Only the status and error code: Supabase's full error can contain the row's values
      const { code } = await res.json().catch(() => ({}));
      throw new Error(`Supabase ${method} failed: ${res.status} ${code || ""}`.trim());
    }
    return res.json();
  }

  const mine = (visitor, id) => ({ visitor_id: `eq.${visitor}`, id: `eq.${id}`, select: COLUMNS });

  return {
    configured,

    // A visitor's newest 1000 sets (optionally one day or one machine), returned oldest first
    async list(visitor, { date, machine } = {}) {
      const params = { visitor_id: `eq.${visitor}`, select: COLUMNS };
      if (date) params.date = `eq.${date}`;
      if (machine) params.machine = `eq.${machine}`;
      params.order = "date.desc,created_at.desc";
      params.limit = MAX_ROWS;
      return (await request("GET", params)).reverse();
    },

    async add(visitor, entry) {
      const [saved] = await request("POST", { select: COLUMNS }, { ...entry, visitor_id: visitor });
      return saved;
    },

    // null if the set doesn't exist or belongs to someone else
    async update(visitor, id, { reps, weight }) {
      const [saved] = await request("PATCH", mine(visitor, id), { reps, weight });
      return saved || null;
    },

    async remove(visitor, id) {
      return (await request("DELETE", mine(visitor, id))).length > 0;
    },

    async hasLog(visitor) {
      return (await request("GET", { visitor_id: `eq.${visitor}`, select: "id", limit: 1 })).length > 0;
    },

    // For the backup and import scripts only: no web route calls these two
    async exportAll() {
      const all = [];
      for (;;) {
        const page = await request("GET", { select: "*", order: "created_at.asc,id.asc", limit: MAX_ROWS, offset: all.length });
        all.push(...page);
        if (page.length < MAX_ROWS) return all;
      }
    },
    importRows: (rows) => request("POST", { select: COLUMNS }, rows),
  };
}

module.exports = { createStorage };
