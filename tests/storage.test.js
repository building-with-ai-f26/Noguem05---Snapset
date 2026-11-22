// Each visitor's log is private, log codes work, and the import keeps history intact.
// Uses a fake Supabase: free, and never touches real data.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { startServer } = require("./helpers.js");
const { startFakeSupabase } = require("./fake-supabase.js");
const { createStorage } = require("../storage.js");
const { importLogs } = require("../scripts/import-logs.js");
const { newCode, parseCode, formatCode, hashCode } = require("../visitor.js");
const { MACHINES, today } = require("../server.js");

const TIMEOUT = { timeout: 15000 };

// Acts like one browser: remembers its own cookie
function browser(call, cookie = "") {
  return async function send(route, method = "GET", body) {
    const res = await call(route, { method, headers: cookie ? { Cookie: cookie } : {}, body: body && JSON.stringify(body) });
    const set = res.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0];
    return { status: res.status, data: await res.json(), set };
  };
}

const LEG_PRESS = { machine: "Leg Press", reps: 10, weight: 180 };

test("a set can be logged, read, edited and deleted", TIMEOUT, async (t) => {
  const { call, db } = await startServer(t);
  const me = browser(call);
  const { status, data } = await me("/api/log", "POST", LEG_PRESS);
  assert.strictEqual(status, 201);
  assert.deepStrictEqual(data, { id: data.id, ...LEG_PRESS, date: today(), sets: 1 });
  assert.deepStrictEqual((await me("/api/today")).data, [data]);
  assert.strictEqual((await me(`/api/log?id=${data.id}`, "PUT", { reps: 8, weight: 190 })).data.weight, 190);
  assert.strictEqual((await me("/api/last?machine=Leg%20Press")).data.weight, 190);
  assert.strictEqual((await me(`/api/log?id=${data.id}`, "DELETE")).status, 200);
  assert.deepStrictEqual(db.state.rows, []);
  assert.strictEqual(db.state.badAuth, 0, "key goes in apikey, not Authorization");
});

test("another visitor can't read, edit or delete my sets", TIMEOUT, async (t) => {
  const { call, db } = await startServer(t);
  const { data } = await browser(call)("/api/log", "POST", LEG_PRESS);
  const noCookie = browser(call);
  const otherVisitor = browser(call, `snapset_log=${newCode()}`);
  for (const them of [noCookie, otherVisitor]) {
    assert.deepStrictEqual((await them("/api/today")).data, []);
    assert.deepStrictEqual((await them("/api/history?machine=Leg%20Press")).data, []);
    assert.strictEqual((await them("/api/last?machine=Leg%20Press")).data, null);
    assert.strictEqual((await them("/api/summary")).data.totalSets, 0);
    assert.strictEqual((await them(`/api/log?id=${data.id}`, "PUT", { reps: 1, weight: 1 })).status, 404);
    assert.strictEqual((await them(`/api/log?id=${data.id}`, "DELETE")).status, 404);
  }
  assert.strictEqual(db.state.rows.length, 1);
  assert.strictEqual(db.state.rows[0].weight, 180);
});

test("a log code opens the same log on a second device", TIMEOUT, async (t) => {
  const { call } = await startServer(t);
  const phone = browser(call);
  const laptop = browser(call);
  await phone("/api/log", "POST", LEG_PRESS);
  const { code } = (await phone("/api/code", "POST", {})).data;
  assert.strictEqual((await laptop("/api/code/use", "POST", { code: code.toLowerCase().replaceAll("-", " ") })).status, 200);
  await laptop("/api/log", "POST", { ...LEG_PRESS, weight: 200 });
  assert.deepStrictEqual((await phone("/api/today")).data.map((s) => s.weight), [180, 200]);
});

test("an unknown or malformed code is refused and sets no cookie", TIMEOUT, async (t) => {
  const { call } = await startServer(t);
  for (const code of [newCode(), "hello", "", null, { a: 1 }, "x".repeat(500)]) {
    const res = await browser(call)("/api/code/use", "POST", { code });
    assert.strictEqual(res.status, 404);
    assert.strictEqual(res.set, null);
  }
});

test("guessing codes hits the rate limit", TIMEOUT, async (t) => {
  const { call } = await startServer(t);
  let blocked = 0;
  for (let i = 0; i < 30; i++) {
    if ((await browser(call)("/api/code/use", "POST", { code: newCode() })).status === 429) blocked++;
  }
  assert.strictEqual(blocked, 10);
});

test("the database stores a hash of the code, and the browser never gets it", TIMEOUT, async (t) => {
  const { call, db } = await startServer(t);
  const me = browser(call);
  const { data } = await me("/api/log", "POST", LEG_PRESS);
  const code = parseCode((await me("/api/code", "POST", {})).data.code);
  assert.strictEqual(db.state.rows[0].visitor_id, hashCode(code));
  assert.ok(!JSON.stringify(db.state.rows).includes(code));
  assert.ok(!("visitor_id" in data));
});

test("the cookie is HttpOnly, and Secure on Render", TIMEOUT, async (t) => {
  const local = await startServer(t);
  assert.match((await browser(local.call)("/api/code", "POST", {})).set, /HttpOnly; SameSite=Lax$/);
  const live = await startServer(t, { env: { RENDER: "true" } });
  assert.match((await browser(live.call)("/api/code", "POST", {})).set, /^__Host-snapset_log=.*; Path=\/;.*HttpOnly;.*Secure$/);
});

test("ids and machines can't be used to change the database query", TIMEOUT, async (t) => {
  const { call, db } = await startServer(t);
  const me = browser(call);
  await me("/api/log", "POST", LEG_PRESS);
  for (const id of ["x", "neq.x", "00000000-0000-0000-0000-000000000000&or=(id.not.is.null)", "*"]) {
    assert.strictEqual((await me(`/api/log?id=${encodeURIComponent(id)}`, "DELETE")).status, 404, id);
  }
  assert.strictEqual((await me("/api/history?machine=neq.x")).status, 400);
  assert.strictEqual(db.state.rows.length, 1);
});

test("reads are limited too", TIMEOUT, async (t) => {
  const { call } = await startServer(t);
  let blocked = 0;
  for (let i = 0; i < 250; i++) {
    const res = await call("/api/today");
    await res.arrayBuffer();
    if (res.status === 429) blocked++;
  }
  assert.strictEqual(blocked, 10);
});

test("codes are random and forgive common typing slips", () => {
  const codes = new Set(Array.from({ length: 1000 }, newCode));
  assert.strictEqual(codes.size, 1000);
  for (const code of codes) assert.strictEqual(parseCode(formatCode(code)), code);
  assert.strictEqual(parseCode("oooo-iiii-llll-2222-3333\n"), "00001111111122223333");
});

test("import: preview changes nothing; confirm keeps every set, in order, only once", TIMEOUT, async (t) => {
  const db = await startFakeSupabase();
  t.after(() => db.close());
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "snapset-"));
  const logFile = path.join(dir, "logs.json");
  const codeFile = path.join(dir, "code.txt");
  const old = [
    { id: "11111111-1111-4111-8111-111111111111", machine: "Leg Press", date: "2026-11-05", sets: 3, reps: 10, weight: 180 },
    { id: "22222222-2222-4222-8222-222222222222", machine: "Leg Press", date: "2026-11-14", sets: 1, reps: 8, weight: 190 },
    { id: "33333333-3333-4333-8333-333333333333", machine: "Leg Press", date: "2026-11-14", sets: 1, reps: 6, weight: 200.5 },
  ];
  fs.writeFileSync(logFile, JSON.stringify(old));
  const storage = createStorage(db.env.SUPABASE_URL, db.env.SUPABASE_SECRET_KEY);
  const options = { storage, logFile, codeFile };

  await importLogs({ ...options, confirm: false });
  assert.deepStrictEqual([db.state.rows.length, fs.existsSync(codeFile)], [0, false]);

  assert.strictEqual((await importLogs({ ...options, confirm: true })).imported, 3);
  const owner = hashCode(parseCode(fs.readFileSync(codeFile, "utf8")));
  assert.deepStrictEqual(await storage.list(owner), old);
  await assert.rejects(importLogs({ ...options, confirm: true }), /already has sets/);
  assert.strictEqual(db.state.rows.length, 3);
});

test("the backup reads past Supabase's 1000-row page", TIMEOUT, async (t) => {
  const db = await startFakeSupabase();
  t.after(() => db.close());
  for (let i = 0; i < 2345; i++) db.state.rows.push({ id: String(i).padStart(5, "0"), created_at: "2026-11-22" });
  const all = await createStorage(db.env.SUPABASE_URL, db.env.SUPABASE_SECRET_KEY).exportAll();
  assert.strictEqual(new Set(all.map((r) => r.id)).size, 2345);
});

test("schema.sql and server.js list the same machines", () => {
  const sql = fs.readFileSync(path.join(__dirname, "..", "supabase", "schema.sql"), "utf8");
  const inSql = sql.match(/machine in \(([\s\S]*?)\)/)[1].match(/'[^']+'/g).map((s) => s.slice(1, -1));
  assert.deepStrictEqual(inSql, Object.keys(MACHINES));
});
