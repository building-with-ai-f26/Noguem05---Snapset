// Keeps the machine list consistent as it gets edited.
const test = require("node:test");
const assert = require("node:assert");
const { MACHINES, OTHER } = require("../machines.js");

const lower = (s) => s.toLowerCase();

test("30-50 machines with unique names", () => {
  assert.ok(MACHINES.length >= 30 && MACHINES.length <= 50, `${MACHINES.length} machines`);
  assert.strictEqual(new Set(MACHINES.map((m) => lower(m.name))).size, MACHINES.length);
});

test("no alias points at two machines or repeats a machine name", () => {
  const names = new Set(MACHINES.map((m) => lower(m.name)));
  const seen = new Map();
  for (const m of MACHINES) {
    for (const alias of m.aliases) {
      assert.ok(!names.has(lower(alias)), `"${alias}" is also a machine name`);
      assert.ok(!seen.has(lower(alias)), `"${alias}" is on ${seen.get(lower(alias))} and ${m.name}`);
      seen.set(lower(alias), m.name);
    }
  }
});

test("every machine has exercises with muscles and no duplicates", () => {
  for (const m of MACHINES) {
    assert.ok(m.exercises.length >= 1, m.name);
    assert.strictEqual(new Set(m.exercises.map((e) => lower(e.name))).size, m.exercises.length, m.name);
    for (const e of m.exercises) {
      assert.ok(e.name === OTHER || e.muscles, `${m.name} / ${e.name} has no muscles`);
      assert.ok(e.name.length <= 40, `${m.name} / ${e.name} is too long`);
    }
    // "Other" only makes sense on machines that already offer a choice, and goes last
    const other = m.exercises.findIndex((e) => e.name === OTHER);
    if (other >= 0) assert.ok(other === m.exercises.length - 1 && m.exercises.length > 2, m.name);
  }
});

test("the cable machine has the requested exercises", () => {
  const cable = MACHINES.find((m) => m.name === "Cable Machine");
  assert.deepStrictEqual(cable.exercises.map((e) => e.name), [
    "Seated Row", "Lat Pulldown", "Cable Crossover", "Triceps Pushdown", "Face Pull", "Biceps Curl", "Glute Kickback", "Other",
  ]);
  for (const alias of ["cable tower", "multi-station"]) assert.ok(cable.aliases.includes(alias));
});

test("the 6 original machines are kept, so old sets still match", () => {
  const names = MACHINES.map((m) => m.name);
  for (const m of ["Leg Press", "Chest Press", "Lat Pulldown", "Seated Row", "Leg Extension", "Shoulder Press"]) {
    assert.ok(names.includes(m), m);
    assert.ok(MACHINES.find((x) => x.name === m).exercises.some((e) => e.name === m), `${m} keeps its own exercise`);
  }
});
