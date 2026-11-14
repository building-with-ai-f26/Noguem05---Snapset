// Run with: npm test
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { addLog, readLogs, updateLog, deleteLog, lastLogFor, historyFor, workoutSummary } = require("../server.js");

// Use a throwaway file so tests never touch your real logs
const tmpFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), "snapset-")), "logs.json");
const set = (machine, date, reps, weight) => ({ machine, date, sets: 1, reps, weight });

test("no logs yet returns null", () => {
  assert.strictEqual(lastLogFor("Leg Press", tmpFile()), null);
});

test("returns the most recent log for the chosen machine only", () => {
  const file = tmpFile();
  addLog({ machine: "Leg Press", date: "2026-11-01", sets: 3, reps: 10, weight: 180 }, file);
  addLog({ machine: "Chest Press", date: "2026-11-02", sets: 3, reps: 8, weight: 90 }, file);
  addLog({ machine: "Leg Press", date: "2026-11-03", sets: 4, reps: 8, weight: 200 }, file);

  const { id, ...last } = lastLogFor("Leg Press", file);
  assert.ok(id, "every saved log gets an id");
  assert.deepStrictEqual(last, { machine: "Leg Press", date: "2026-11-03", sets: 4, reps: 8, weight: 200 });
  assert.strictEqual(lastLogFor("Chest Press", file).weight, 90);
});

test("old logs without an id get one, and keep it on the next read", () => {
  const file = tmpFile();
  fs.writeFileSync(file, JSON.stringify([{ machine: "Leg Press", date: "2026-11-01", sets: 3, reps: 10, weight: 180 }]));
  const first = readLogs(file)[0].id;
  assert.ok(first);
  assert.strictEqual(readLogs(file)[0].id, first);
});

test("a set can be edited and deleted by id", () => {
  const file = tmpFile();
  const a = addLog(set("Leg Press", "2026-11-14", 10, 180), file);
  const b = addLog(set("Leg Press", "2026-11-14", 10, 180), file);

  assert.strictEqual(updateLog(a.id, { reps: 8, weight: 190 }, file).weight, 190);
  assert.strictEqual(deleteLog(b.id, file), true);
  assert.deepStrictEqual(readLogs(file).map((l) => [l.reps, l.weight]), [[8, 190]]);

  assert.strictEqual(updateLog("no-such-id", { reps: 1, weight: 1 }, file), null);
  assert.strictEqual(deleteLog("no-such-id", file), false);
});

test("history groups sets by day, newest first, with the top weight of each day", () => {
  const logs = [
    set("Leg Press", "2026-11-01", 10, 180),
    set("Leg Press", "2026-11-01", 8, 190),
    set("Chest Press", "2026-11-02", 8, 90),
    set("Leg Press", "2026-11-05", 10, 200),
  ];
  const history = historyFor("Leg Press", logs);
  assert.deepStrictEqual(history.map((s) => [s.date, s.sets.length, s.topWeight]), [
    ["2026-11-05", 1, 200],
    ["2026-11-01", 2, 190],
  ]);
  assert.deepStrictEqual(historyFor("Seated Row", logs), []);
});

test("workout summary: machines, total sets, and weight increases vs the previous session", () => {
  const logs = [
    // Previous sessions
    set("Leg Press", "2026-11-01", 10, 150), // older session, ignored
    set("Leg Press", "2026-11-10", 10, 180),
    set("Chest Press", "2026-11-10", 8, 90),
    { machine: "Seated Row", date: "2026-11-10", sets: 3, reps: 10, weight: 70 }, // pre-Build-2 entry
    // Today
    set("Leg Press", "2026-11-14", 10, 180),
    set("Leg Press", "2026-11-14", 8, 190), // up from 180
    set("Chest Press", "2026-11-14", 8, 90), // same as last time
    set("Seated Row", "2026-11-14", 10, 65), // down
    set("Shoulder Press", "2026-11-14", 10, 40), // first time ever: no comparison
  ];
  assert.deepStrictEqual(workoutSummary(logs, "2026-11-14"), {
    date: "2026-11-14",
    machines: ["Leg Press", "Chest Press", "Seated Row", "Shoulder Press"],
    totalSets: 5,
    increases: [{ machine: "Leg Press", from: 180, to: 190 }],
  });
});

test("old multi-set entries count every set in the total", () => {
  const logs = [{ machine: "Leg Press", date: "2026-11-14", sets: 3, reps: 10, weight: 180 }, set("Leg Press", "2026-11-14", 10, 180)];
  assert.strictEqual(workoutSummary(logs, "2026-11-14").totalSets, 4);
});

test("an empty day gives an empty summary", () => {
  assert.deepStrictEqual(workoutSummary([], "2026-11-14"), { date: "2026-11-14", machines: [], totalSets: 0, increases: [] });
});
