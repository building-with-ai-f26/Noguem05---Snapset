// Tries to break a real SnapSet server started just for the test.
// Throwaway data, no API key: free, and never touches your real log.
// Every network step has a timeout so a test can't hang.
const test = require("node:test");
const assert = require("node:assert");
const { spawn } = require("child_process");
const fs = require("fs");
const net = require("net");
const os = require("os");
const path = require("path");

const TIMEOUT = { timeout: 15000 };

async function startServer(t, seed, env = {}) {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "snapset-")), "logs.json");
  if (seed !== undefined) fs.writeFileSync(file, seed);
  const child = spawn(process.execPath, [path.join(__dirname, "..", "server.js")], {
    env: { ...process.env, PORT: "0", SNAPSET_DATA_FILE: file, OPENROUTER_API_KEY: "", RENDER: "", ...env },
  });
  t.after(() => child.kill());
  child.stderr.resume();
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("server didn't start")), 5000);
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk;
      const found = output.match(/localhost:([1-9]\d*)/);
      if (found) {
        clearTimeout(timer);
        resolve(Number(found[1]));
      }
    });
  });
  const call = (route, options = {}) =>
    fetch(`http://127.0.0.1:${port}${route}`, { ...options, signal: AbortSignal.timeout(3000) });
  return { port, call };
}

// fetch tidies up bad requests, so these are sent as raw text
function rawStatus(port, text) {
  return new Promise((resolve) => {
    const socket = net.connect(port, "127.0.0.1", () => socket.write(text));
    let reply = "";
    const done = () => resolve(Number(reply.split(" ")[1]) || 0);
    socket.on("data", (chunk) => {
      reply += chunk;
      if (reply.includes("\r\n")) { done(); socket.destroy(); }
    });
    socket.on("error", done);
    socket.on("close", done);
    socket.setTimeout(3000, () => socket.destroy());
  });
}

test("a malformed Host header doesn't crash the server", TIMEOUT, async (t) => {
  const { port, call } = await startServer(t);
  assert.strictEqual(await rawStatus(port, "GET / HTTP/1.1\r\nHost: a b\r\n\r\n"), 200);
  assert.strictEqual((await call("/api/machines")).status, 200);
});

test("odd paths don't crash the server", TIMEOUT, async (t) => {
  const { port, call } = await startServer(t);
  assert.strictEqual(await rawStatus(port, "GET // HTTP/1.1\r\nHost: localhost\r\n\r\n"), 404);
  assert.strictEqual(await rawStatus(port, "OPTIONS * HTTP/1.1\r\nHost: localhost\r\n\r\n"), 400);
  assert.strictEqual((await call("/api/machines")).status, 200);
});

test("broken storage is a 500 without internal details, not a crash", TIMEOUT, async (t) => {
  const { call } = await startServer(t, "{bad");
  const res = await call("/api/today");
  assert.strictEqual(res.status, 500);
  assert.deepStrictEqual(await res.json(), { error: "Something went wrong. Please try again." });
  assert.strictEqual((await call("/api/machines")).status, 200);
});

test("bad sets are refused", TIMEOUT, async (t) => {
  const { call } = await startServer(t);
  const bad = [
    '{"machine":"constructor","reps":1,"weight":1}',
    '{"machine":"__proto__","reps":1,"weight":1}',
    '{"machine":["Leg Press"],"reps":1,"weight":1}',
    '{"machine":"Leg Press","reps":1,"weight":null}',
    '{"machine":"Leg Press","reps":1,"weight":1e300}',
    '{"machine":"Leg Press","reps":1,"weight":-1}',
    '{"machine":"Leg Press","reps":1e999,"weight":1}',
    '{"machine":"Leg Press","reps":0.5,"weight":1}',
    '{"machine":"Leg Press","reps":true,"weight":1}',
    '{"machine":"Leg Press","reps":"10","weight":1}',
    "null",
    "not json",
  ];
  for (const body of bad) assert.strictEqual((await call("/api/log", { method: "POST", body })).status, 400, body);
  assert.deepStrictEqual(await (await call("/api/today")).json(), []);
});

test("editing follows the same rules as logging", TIMEOUT, async (t) => {
  const { call } = await startServer(t);
  const { id } = await (await call("/api/log", { method: "POST", body: '{"machine":"Leg Press","reps":10,"weight":100}' })).json();
  const res = await call(`/api/log?id=${id}`, { method: "PUT", body: '{"reps":10,"weight":1e300}' });
  assert.strictEqual(res.status, 400);
});

test("an upload that declares it is too big is refused at once", TIMEOUT, async (t) => {
  const { port } = await startServer(t);
  const text = "POST /api/log HTTP/1.1\r\nHost: localhost\r\nContent-Length: 50000000\r\n\r\n";
  assert.strictEqual(await rawStatus(port, text), 413);
});

test("an upload without a declared size is cut off at the route's limit", TIMEOUT, async (t) => {
  const { port } = await startServer(t);
  const chunk = "a".repeat(20000);
  const text = `POST /api/log HTTP/1.1\r\nHost: localhost\r\nTransfer-Encoding: chunked\r\n\r\n${chunk.length.toString(16)}\r\n${chunk}\r\n`;
  assert.strictEqual(await rawStatus(port, text), 413);
});

test("'today' is New York's date, even on a UTC server", () => {
  const { today } = require("../server.js");
  assert.strictEqual(today(new Date("2026-11-23T01:00:00Z")), "2026-11-22"); // 8pm in New York
  assert.strictEqual(today(new Date("2026-11-23T05:30:00Z")), "2026-11-23"); // 12:30am
});

test("prototype names from the AI mean 'not sure'", () => {
  const { parseIdentification } = require("../server.js");
  assert.strictEqual(parseIdentification('{"machine":"constructor"}').machine, null);
});

// ---- Rate limits and browser protections ----

async function statuses(count, send) {
  const seen = {};
  for (let i = 0; i < count; i++) {
    const { status } = await send(i);
    seen[status] = (seen[status] || 0) + 1;
  }
  return seen;
}

test("30 fast photo calls: 10 get through, 20 get 429", TIMEOUT, async (t) => {
  const { call } = await startServer(t);
  const send = () => call("/api/identify", { method: "POST", body: '{"image":"not a photo"}' });
  assert.deepStrictEqual(await statuses(30, send), { 400: 10, 429: 20 });
  const blocked = await send();
  assert.ok(Number(blocked.headers.get("retry-after")) > 0);
  assert.match((await blocked.json()).error, /Too many/);
});

for (const method of ["POST", "PUT", "DELETE"]) {
  test(`30 fast ${method} writes: the last 10 get 429`, TIMEOUT, async (t) => {
    const { call } = await startServer(t);
    const options = method === "DELETE" ? { method } : { method, body: "{}" };
    const seen = await statuses(30, () => call("/api/log?id=no-such-id", options));
    assert.strictEqual(seen[429], 10);
  });
}

test("made-up IP headers don't reset the limit", TIMEOUT, async (t) => {
  const { call } = await startServer(t);
  const seen = await statuses(30, (i) => call("/api/identify", {
    method: "POST",
    body: "{}",
    headers: { "X-Forwarded-For": `1.2.3.${i}`, "CF-Connecting-IP": `1.2.3.${i}`, "X-Real-IP": `1.2.3.${i}` },
  }));
  assert.strictEqual(seen[429], 20);
});

test("on Render each real visitor IP has its own limit", TIMEOUT, async (t) => {
  const { call } = await startServer(t, undefined, { RENDER: "true" });
  const from = (ip) => () => call("/api/identify", {
    method: "POST",
    body: "{}",
    headers: { "CF-Connecting-IP": ip, "X-Forwarded-For": String(Math.random()) },
  });
  assert.strictEqual((await statuses(11, from("203.0.113.1")))[429], 1);
  assert.strictEqual((await from("203.0.113.2")()).status, 400);
});

test("an IPv6 visitor can't dodge the limit by changing address within their network", () => {
  const { limitKey } = require("../security.js");
  assert.strictEqual(limitKey("2001:db8:1:2::1"), limitKey("2001:db8:1:2:ffff:eeee:dddd:cccc"));
  assert.notStrictEqual(limitKey("2001:db8:1:2::1"), limitKey("2001:db8:1:3::1"));
  assert.notStrictEqual(limitKey("2001:db8::1"), limitKey("2001:db9::1"));
  assert.strictEqual(limitKey("::ffff:203.0.113.9"), "203.0.113.9");
});

test("a limit opens again after its window", () => {
  const { createLimiter } = require("../security.js");
  let now = 0;
  const hit = createLimiter(2, 1000, () => now);
  assert.deepStrictEqual([hit("a"), hit("a"), hit("a")], [0, 0, 1]);
  now = 1000;
  assert.strictEqual(hit("a"), 0);
});

test("another website can't make a visitor's browser write", TIMEOUT, async (t) => {
  const { call } = await startServer(t);
  for (const site of ["cross-site", "same-site"]) {
    const res = await call("/api/log", { method: "POST", body: "{}", headers: { "Sec-Fetch-Site": site } });
    assert.strictEqual(res.status, 403);
  }
});

test("security headers are on the page and the API", TIMEOUT, async (t) => {
  const { call } = await startServer(t);
  for (const route of ["/", "/api/machines", "/no-such-page"]) {
    const { headers } = await call(route);
    assert.strictEqual(headers.get("x-content-type-options"), "nosniff", route);
    assert.match(headers.get("content-security-policy"), /frame-ancestors 'none'/);
    assert.doesNotMatch(headers.get("content-security-policy").match(/script-src[^;]*/)[0], /unsafe/);
  }
  assert.strictEqual((await call("/api/today")).headers.get("cache-control"), "no-store");
  assert.strictEqual((await call("/healthz")).status, 200);
});
