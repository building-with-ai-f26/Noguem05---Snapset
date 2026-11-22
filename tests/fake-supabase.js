// A tiny stand-in for Supabase's REST API, so tests are free and never touch real data.
// It understands only what storage.js sends.

const http = require("http");
const crypto = require("crypto");

const KEY = "test-only-not-a-real-key";
const NOT_FILTERS = ["select", "order", "limit", "offset"];

async function startFakeSupabase({ broken = false } = {}) {
  const state = { rows: [], badAuth: 0 };
  let clock = Date.now();

  const server = http.createServer(async (req, res) => {
    const reply = (status, data) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(data));
    };
    let body = "";
    for await (const chunk of req) body += chunk;

    if (broken) return reply(500, { code: "XX000", message: "internal database detail" });
    if (req.headers.apikey !== KEY || req.headers.authorization) {
      state.badAuth++;
      return reply(401, { code: "401" });
    }

    const url = new URL(req.url, "http://localhost");
    if (url.pathname !== "/rest/v1/logs") return reply(404, {});
    const query = url.searchParams;
    const filters = [...query].filter(([name]) => !NOT_FILTERS.includes(name));
    const matches = (row) => filters.every(([name, value]) => `eq.${row[name]}` === value);
    const shape = (rows) => {
      const columns = query.get("select") || "*";
      if (columns === "*") return rows;
      return rows.map((row) => Object.fromEntries(columns.split(",").map((c) => [c, row[c]])));
    };

    if (req.method === "POST") {
      const added = [JSON.parse(body)].flat().map((row) => ({
        id: crypto.randomUUID(),
        created_at: new Date(clock++).toISOString(),
        ...row,
      }));
      state.rows.push(...added);
      return reply(201, shape(added));
    }

    const found = state.rows.filter(matches);
    if (req.method === "PATCH") for (const row of found) Object.assign(row, JSON.parse(body));
    if (req.method === "DELETE") state.rows = state.rows.filter((row) => !found.includes(row));
    if (req.method === "GET") {
      const order = query.get("order")?.split(",").map((part) => part.split(".")) || [];
      found.sort((a, b) => {
        for (const [name, direction] of order) {
          if (a[name] !== b[name]) return (a[name] < b[name] ? -1 : 1) * (direction === "desc" ? -1 : 1);
        }
        return 0;
      });
      const offset = Number(query.get("offset") || 0);
      return reply(200, shape(found.slice(offset, offset + Number(query.get("limit") || 1000))));
    }
    return reply(200, shape(found));
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    state,
    env: { SUPABASE_URL: `http://127.0.0.1:${server.address().port}`, SUPABASE_SECRET_KEY: KEY },
    close() {
      server.closeAllConnections();
      server.close();
    },
  };
}

module.exports = { startFakeSupabase };
