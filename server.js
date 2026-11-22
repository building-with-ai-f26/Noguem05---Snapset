// SnapSet — a small server. No dependencies: only built-in Node modules.
// Serves public/index.html, saves workout logs to Supabase (storage.js), keeps each
// visitor's log private (visitor.js), limits abuse (security.js), and asks an AI
// vision model (via OpenRouter) which machine is in a photo.

const http = require("http");
const fs = require("fs");
const path = require("path");
const { createStorage } = require("./storage.js");
const { newCode, parseCode, formatCode, hashCode, readCode, saveCode } = require("./visitor.js");
const { cleanKey, redact, LIMITS, MINUTE, DAY, createLimiter, limitKey, clientIp, isCrossSite, buildHeaders } = require("./security.js");

// Load secrets from .env (never committed). Built into Node 22, nothing to install.
try {
  process.loadEnvFile(path.join(__dirname, ".env"));
} catch {
  // No .env file: the app still runs, photo identification just won't work.
}

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, "public");
const storage = createStorage();
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

// ---- Workout math. A log entry is { id, machine, date, sets, reps, weight } ----
// Each entry is one set (sets: 1). Entries saved before Build 2 may have sets > 1
// ("3 sets x 10 reps" in one entry); totals add them up so they still count correctly.

// Always New York's date, e.g. 2026-11-05. (Render's clock is UTC, so evenings would count as tomorrow.)
const today = (now = new Date()) => now.toLocaleDateString("en-CA", { timeZone: "America/New_York" });

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

// ---- Validation ----

// hasOwn, so built-in names like "constructor" don't count as machines
const isMachine = (name) => typeof name === "string" && Object.hasOwn(MACHINES, name);
const isReps = (n) => Number.isInteger(n) && n >= 1 && n <= 200;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isWeight = (n) => typeof n === "number" && n >= 0 && n <= 2000;

// ---- AI identification (OpenRouter) ----

// Turn the model's text reply into { machine, muscleGroup }.
// Anything that isn't exactly one of our machines becomes machine: null ("not sure").
function parseIdentification(text) {
  try {
    const cleaned = String(text).replace(/```(json)?/g, "").trim(); // some models wrap JSON in ``` fences
    const { machine } = JSON.parse(cleaned);
    if (isMachine(machine)) return { machine, muscleGroup: MACHINES[machine] };
  } catch {
    // Not valid JSON: treat as "not sure"
  }
  return { machine: null, muscleGroup: null };
}

async function identifyMachine(imageDataUrl) {
  const apiKey = cleanKey("OPENROUTER_API_KEY", process.env.OPENROUTER_API_KEY);
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is missing. Add it to your .env file.");

  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    signal: AbortSignal.timeout(30000), // don't wait forever for the AI
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

// An error whose message is safe to show the visitor
class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const MAX_SET_BYTES = 4 * 1024;
const MAX_PHOTO_BYTES = 2 * 1024 * 1024; // the page shrinks photos to well under this

function readBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const tooBig = () => reject(new HttpError(413, "That's too large to upload."));
    if (Number(req.headers["content-length"]) > maxBytes) return tooBig();
    const chunks = [];
    let size = 0;
    function onData(chunk) {
      size += chunk.length;
      if (size > maxBytes) {
        // Stop reading: don't keep the rest in memory
        req.off("data", onData);
        req.pause();
        return tooBig();
      }
      chunks.push(chunk);
    }
    req.on("data", onData);
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", () => reject(new HttpError(400, "Upload interrupted.")));
  });
}

async function readJson(req, maxBytes) {
  const body = await readBody(req, maxBytes);
  try {
    const data = JSON.parse(body);
    if (data && typeof data === "object") return data;
  } catch {
    // Not JSON: refused below
  }
  throw new HttpError(400, "Invalid request.");
}

// ---- Protections (see security.js) ----

const SECURITY_HEADERS = buildHeaders(fs.readFileSync(path.join(PUBLIC_DIR, "index.html"), "utf8"));
const photoLimit = createLimiter(LIMITS.photosPerMinute, MINUTE);
const readLimit = createLimiter(LIMITS.readsPerMinute, MINUTE);
const writeLimit = createLimiter(LIMITS.writesPerMinute, MINUTE);
const dailyPhotoLimit = createLimiter(LIMITS.photosPerDay, DAY);

function enforce(res, waitSeconds, message) {
  if (!waitSeconds) return;
  res.setHeader("Retry-After", waitSeconds);
  throw new HttpError(429, message);
}

// Runs before any route does any work
function protect(req, res, pathname) {
  if (!pathname.startsWith("/api/")) return;
  res.setHeader("Cache-Control", "no-store");
  const visitor = limitKey(clientIp(req));
  if (req.method === "GET" || req.method === "HEAD") {
    return enforce(res, readLimit(visitor), "Too many requests. Wait a minute and try again.");
  }
  if (isCrossSite(req)) throw new HttpError(403, "Requests from other sites aren't allowed.");
  if (pathname === "/api/identify") {
    enforce(res, photoLimit(visitor), "Too many photos. Wait a minute, or pick the machine below.");
  } else {
    enforce(res, writeLimit(visitor), "Too many changes. Wait a minute and try again.");
  }
}

// ---- Routes ----

async function handle(req, res) {
  // Never build the URL from the Host header: the visitor controls it
  if (!req.url.startsWith("/")) throw new HttpError(400, "Invalid request.");
  const url = new URL("http://localhost" + req.url);
  protect(req, res, url.pathname);

  // Render asks this to check the app is up
  if (req.method === "GET" && url.pathname === "/healthz") return sendJson(res, 200, { ok: true });

  // GET /api/machines -> { "Leg Press": "Quads, glutes", ... }
  if (req.method === "GET" && url.pathname === "/api/machines") {
    return sendJson(res, 200, MACHINES);
  }

  // POST /api/identify  { image: "data:image/jpeg;base64,..." } -> { machine, muscleGroup }
  if (req.method === "POST" && url.pathname === "/api/identify") {
    const { image } = await readJson(req, MAX_PHOTO_BYTES);
    if (typeof image !== "string" || !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/.test(image)) {
      throw new HttpError(400, "Send a JPEG, PNG or WebP photo.");
    }
    if (process.env.OPENROUTER_API_KEY) {
      enforce(res, dailyPhotoLimit("app"), "Photo ID hit its limit for today. Pick the machine below.");
    }
    try {
      return sendJson(res, 200, await identifyMachine(image));
    } catch (err) {
      console.error("Identify failed:", redact(err.message));
      return sendJson(res, 502, { error: "Couldn't identify the photo. Pick the machine below." });
    }
  }

  // Everything below only ever sees this visitor's own sets
  const code = readCode(req);
  const owner = code && hashCode(code);
  const myLogs = (filter) => (owner ? storage.list(owner, filter) : []);
  const machineParam = url.searchParams.get("machine");
  const id = url.searchParams.get("id");

  // GET /api/last?machine=Leg%20Press  -> last log for that machine (or null)
  if (req.method === "GET" && url.pathname === "/api/last") {
    if (!isMachine(machineParam)) throw new HttpError(400, "Unknown machine.");
    return sendJson(res, 200, (await myLogs({ machine: machineParam })).at(-1) || null);
  }

  // GET /api/today -> every set logged today, in the order you did them
  if (req.method === "GET" && url.pathname === "/api/today") {
    return sendJson(res, 200, await myLogs({ date: today() }));
  }

  // GET /api/history?machine=Leg%20Press -> past sessions on that machine, newest first
  if (req.method === "GET" && url.pathname === "/api/history") {
    if (!isMachine(machineParam)) throw new HttpError(400, "Unknown machine.");
    return sendJson(res, 200, historyFor(machineParam, await myLogs({ machine: machineParam })));
  }

  // GET /api/summary -> today's "Finish workout" summary
  if (req.method === "GET" && url.pathname === "/api/summary") {
    return sendJson(res, 200, workoutSummary(await myLogs(), today()));
  }

  // POST /api/code -> this browser's log code, to type on another device
  if (req.method === "POST" && url.pathname === "/api/code") {
    const mine = code || newCode();
    saveCode(res, mine);
    return sendJson(res, 200, { code: formatCode(mine) });
  }

  // POST /api/code/use  { code } -> this browser switches to that code's log
  if (req.method === "POST" && url.pathname === "/api/code/use") {
    const typed = parseCode((await readJson(req, MAX_SET_BYTES)).code);
    // An unknown code is refused, so a typo can't quietly open a new empty log
    if (!typed || !(await storage.hasLog(hashCode(typed)))) {
      throw new HttpError(404, "No log found for that code. Check it, or log a set on the first device.");
    }
    saveCode(res, typed);
    return sendJson(res, 200, { ok: true });
  }

  // POST /api/log  { machine, reps, weight } -> saves ONE set with today's date
  if (req.method === "POST" && url.pathname === "/api/log") {
    const { machine, reps, weight } = await readJson(req, MAX_SET_BYTES);
    if (!isMachine(machine) || !isReps(reps) || !isWeight(weight)) {
      throw new HttpError(400, "Need a machine, whole reps (1-200) and a weight (0-2000 lb).");
    }
    const mine = code || newCode(); // the first set creates this visitor's log
    const saved = await storage.add(hashCode(mine), { machine, date: today(), sets: 1, reps, weight });
    saveCode(res, mine);
    return sendJson(res, 201, saved);
  }

  // PUT /api/log?id=...  { reps, weight } -> fix a set you mistyped
  if (req.method === "PUT" && url.pathname === "/api/log") {
    const { reps, weight } = await readJson(req, MAX_SET_BYTES);
    if (!isReps(reps) || !isWeight(weight)) {
      throw new HttpError(400, "Need whole reps (1-200) and a weight (0-2000 lb).");
    }
    const updated = owner && UUID.test(id) ? await storage.update(owner, id, { reps, weight }) : null;
    return updated ? sendJson(res, 200, updated) : sendJson(res, 404, { error: "Set not found." });
  }

  // DELETE /api/log?id=... -> remove a set logged by mistake
  if (req.method === "DELETE" && url.pathname === "/api/log") {
    const deleted = owner && UUID.test(id) && (await storage.remove(owner, id));
    return deleted
      ? sendJson(res, 200, { ok: true })
      : sendJson(res, 404, { error: "Set not found." });
  }

  // The web page
  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
    if (code) saveCode(res, code); // each visit renews the cookie
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    return fs.createReadStream(path.join(PUBLIC_DIR, "index.html")).pipe(res);
  }

  res.writeHead(404);
  res.end("Not found");
}

// Every request goes through here, so one bad request can't take the server down
async function safeHandle(req, res) {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) res.setHeader(name, value);
  try {
    await handle(req, res);
  } catch (err) {
    const known = err instanceof HttpError;
    if (!known) console.error("Request failed:", redact(err.message)); // details stay in the server log
    if (res.headersSent) return res.destroy();
    if (err.status === 413) res.setHeader("Connection", "close");
    sendJson(res, known ? err.status : 500, {
      error: known ? err.message : "Something went wrong. Please try again.",
    });
  }
}

if (require.main === module) {
  http.createServer(safeHandle).listen(PORT, function () {
    console.log(`SnapSet running at http://localhost:${this.address().port}`);
    if (!storage.configured) console.log("Note: no SUPABASE_URL / SUPABASE_SECRET_KEY, saving and history are off.");
    if (!process.env.OPENROUTER_API_KEY) console.log("Note: no OPENROUTER_API_KEY in .env, photo identification is off.");
  });
}

module.exports = {
  historyFor, workoutSummary, parseIdentification, today, MACHINES,
};
