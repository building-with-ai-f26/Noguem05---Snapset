// SnapSet — tiny local server. No dependencies: only built-in Node modules.
// Serves public/index.html, saves workout logs to data/logs.json, and asks an
// AI vision model (via OpenRouter) which machine is in a photo.

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// Load secrets from .env (never committed). Built into Node 22, nothing to install.
try {
  process.loadEnvFile(path.join(__dirname, ".env"));
} catch {
  // No .env file: the app still runs, photo identification just won't work.
}

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, "public");
const DATA_FILE = process.env.SNAPSET_DATA_FILE || path.join(__dirname, "data", "logs.json");
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || "deepseek/deepseek-v4.1-flash";

// The machines SnapSet knows about, and the muscles each one works.
// The page and the AI both use this one list.
const MACHINES = {
  "Leg Press": "Quads, glutes",
  "Chest Press": "Chest, triceps",
  "Lat Pulldown": "Back (lats), biceps",
  "Seated Row": "Upper back, biceps",
  "Leg Extension": "Quads",
  "Shoulder Press": "Shoulders, triceps",
};

// ---- Storage: a JSON array of { id, machine, date, sets, reps, weight } ----
// Each entry is one set (sets: 1). Entries saved before Build 2 may have sets > 1
// ("3 sets x 10 reps" in one entry); totals add them up so they still count correctly.

const today = () => new Date().toLocaleDateString("en-CA"); // your local date, e.g. 2026-11-05

function writeLogs(logs, file = DATA_FILE) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(logs, null, 2));
}

function readLogs(file = DATA_FILE) {
  if (!fs.existsSync(file)) return [];
  const logs = JSON.parse(fs.readFileSync(file, "utf8"));
  // Old entries have no id. Give them one (once) so they can be edited or deleted too.
  if (logs.some((l) => !l.id)) {
    for (const l of logs) l.id ||= crypto.randomUUID();
    writeLogs(logs, file);
  }
  return logs;
}

function addLog(entry, file = DATA_FILE) {
  const logs = readLogs(file);
  const saved = { id: crypto.randomUUID(), ...entry };
  logs.push(saved);
  writeLogs(logs, file);
  return saved;
}

// Change the reps/weight of one set. Returns the updated entry, or null if the id doesn't exist.
function updateLog(id, { reps, weight }, file = DATA_FILE) {
  const logs = readLogs(file);
  const entry = logs.find((l) => l.id === id);
  if (!entry) return null;
  entry.reps = Number(reps);
  entry.weight = Number(weight);
  writeLogs(logs, file);
  return entry;
}

// Remove one set. Returns true if something was deleted.
function deleteLog(id, file = DATA_FILE) {
  const logs = readLogs(file);
  const kept = logs.filter((l) => l.id !== id);
  if (kept.length === logs.length) return false;
  writeLogs(kept, file);
  return true;
}

function lastLogFor(machine, file = DATA_FILE) {
  const matches = readLogs(file).filter((l) => l.machine === machine);
  return matches.length ? matches[matches.length - 1] : null;
}

const countSets = (entries) => entries.reduce((sum, l) => sum + (l.sets || 1), 0);
const topWeight = (entries) => Math.max(...entries.map((l) => l.weight));

// Past sessions on one machine, newest first: [{ date, sets: [entries], topWeight }]
function historyFor(machine, logs) {
  const byDate = new Map();
  for (const l of logs.filter((l) => l.machine === machine)) {
    if (!byDate.has(l.date)) byDate.set(l.date, []);
    byDate.get(l.date).push(l);
  }
  return [...byDate.entries()]
    .sort(([a], [b]) => (a < b ? 1 : -1))
    .map(([date, sets]) => ({ date, sets, topWeight: topWeight(sets) }));
}

// Summary for "Finish workout": machines done on `date`, total sets, and every machine where
// today's top weight beats the top weight of your previous session on it.
function workoutSummary(logs, date) {
  const todays = logs.filter((l) => l.date === date);
  const machines = [...new Set(todays.map((l) => l.machine))];
  const increases = [];
  for (const machine of machines) {
    const previous = historyFor(machine, logs).find((s) => s.date < date);
    const now = topWeight(todays.filter((l) => l.machine === machine));
    if (previous && now > previous.topWeight) increases.push({ machine, from: previous.topWeight, to: now });
  }
  return { date, machines, totalSets: countSets(todays), increases };
}

// ---- AI identification (OpenRouter) ----

// Turn the model's text reply into { machine, muscleGroup }.
// Anything that isn't exactly one of our machines becomes machine: null ("not sure").
function parseIdentification(text) {
  try {
    const cleaned = String(text).replace(/```(json)?/g, "").trim(); // some models wrap JSON in ``` fences
    const { machine } = JSON.parse(cleaned);
    if (MACHINES[machine]) return { machine, muscleGroup: MACHINES[machine] };
  } catch {
    // Not valid JSON: treat as "not sure"
  }
  return { machine: null, muscleGroup: null };
}

async function identifyMachine(imageDataUrl) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is missing. Add it to your .env file.");

  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: OPENROUTER_MODEL,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text:
                "This is a photo taken in a gym. Which of these machines is it: " +
                Object.keys(MACHINES).join(", ") +
                '? If it is none of them, or you cannot tell, answer "unknown".',
            },
            { type: "image_url", image_url: { url: imageDataUrl } },
          ],
        },
      ],
      // Force the reply to be {"machine": "<one of our machines or unknown>"}
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "machine_id",
          strict: true,
          schema: {
            type: "object",
            properties: { machine: { type: "string", enum: [...Object.keys(MACHINES), "unknown"] } },
            required: ["machine"],
            additionalProperties: false,
          },
        },
      },
      provider: { require_parameters: true }, // only use providers that support response_format
      max_tokens: 2000,
    }),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(`OpenRouter error ${res.status}: ${data.error?.message || "unknown"}`);
  const result = parseIdentification(data.choices?.[0]?.message?.content);
  console.log(`Identified: ${result.machine || "unknown"} (cost: $${data.usage?.cost ?? "?"})`);
  return result;
}

// ---- HTTP helpers ----

function sendJson(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

function readBody(req, maxBytes = 8 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > maxBytes) reject(new Error("Request too large"));
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

// ---- Routes ----

async function handle(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);

  // GET /api/machines -> { "Leg Press": "Quads, glutes", ... }
  if (req.method === "GET" && url.pathname === "/api/machines") {
    return sendJson(res, 200, MACHINES);
  }

  // POST /api/identify  { image: "data:image/jpeg;base64,..." } -> { machine, muscleGroup }
  if (req.method === "POST" && url.pathname === "/api/identify") {
    try {
      const { image } = JSON.parse(await readBody(req));
      if (!/^data:image\/(jpeg|png|webp);base64,/.test(image || "")) {
        return sendJson(res, 400, { error: "Send a JPEG, PNG or WebP photo." });
      }
      return sendJson(res, 200, await identifyMachine(image));
    } catch (err) {
      console.error("Identify failed:", err.message);
      return sendJson(res, 502, { error: "Couldn't identify the photo. Pick the machine below." });
    }
  }

  // GET /api/last?machine=Leg%20Press  -> last log for that machine (or null)
  if (req.method === "GET" && url.pathname === "/api/last") {
    return sendJson(res, 200, lastLogFor(url.searchParams.get("machine")));
  }

  // GET /api/today -> every set logged today, in the order you did them
  if (req.method === "GET" && url.pathname === "/api/today") {
    return sendJson(res, 200, readLogs().filter((l) => l.date === today()));
  }

  // GET /api/history?machine=Leg%20Press -> past sessions on that machine, newest first
  if (req.method === "GET" && url.pathname === "/api/history") {
    return sendJson(res, 200, historyFor(url.searchParams.get("machine"), readLogs()));
  }

  // GET /api/summary -> today's "Finish workout" summary
  if (req.method === "GET" && url.pathname === "/api/summary") {
    return sendJson(res, 200, workoutSummary(readLogs(), today()));
  }

  // POST /api/log  { machine, reps, weight } -> saves ONE set with today's date
  if (req.method === "POST" && url.pathname === "/api/log") {
    try {
      const { machine, reps, weight } = JSON.parse(await readBody(req));
      if (!MACHINES[machine] || !(reps > 0) || !(weight >= 0)) {
        return sendJson(res, 400, { error: "Need machine, reps and weight." });
      }
      const entry = { machine, date: today(), sets: 1, reps: Number(reps), weight: Number(weight) };
      return sendJson(res, 201, addLog(entry));
    } catch {
      return sendJson(res, 400, { error: "Invalid request." });
    }
  }

  // PUT /api/log?id=...  { reps, weight } -> fix a set you mistyped
  if (req.method === "PUT" && url.pathname === "/api/log") {
    try {
      const { reps, weight } = JSON.parse(await readBody(req));
      if (!(reps > 0) || !(weight >= 0)) return sendJson(res, 400, { error: "Need reps and weight." });
      const updated = updateLog(url.searchParams.get("id"), { reps, weight });
      return updated ? sendJson(res, 200, updated) : sendJson(res, 404, { error: "Set not found." });
    } catch {
      return sendJson(res, 400, { error: "Invalid request." });
    }
  }

  // DELETE /api/log?id=... -> remove a set logged by mistake
  if (req.method === "DELETE" && url.pathname === "/api/log") {
    return deleteLog(url.searchParams.get("id"))
      ? sendJson(res, 200, { ok: true })
      : sendJson(res, 404, { error: "Set not found." });
  }

  // The web page
  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    return fs.createReadStream(path.join(PUBLIC_DIR, "index.html")).pipe(res);
  }

  res.writeHead(404);
  res.end("Not found");
}

if (require.main === module) {
  http.createServer(handle).listen(PORT, () => {
    console.log(`SnapSet running at http://localhost:${PORT}`);
    if (!process.env.OPENROUTER_API_KEY) console.log("Note: no OPENROUTER_API_KEY in .env, photo identification is off.");
  });
}

module.exports = {
  readLogs, addLog, updateLog, deleteLog, lastLogFor, historyFor, workoutSummary, parseIdentification, MACHINES,
};
