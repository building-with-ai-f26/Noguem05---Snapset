// Copies the old local log (data/logs.json) into Supabase under one private log code.
//   node scripts/import-logs.js              preview: changes nothing
//   node scripts/import-logs.js --confirm    really import
// The code is saved to data/my-log-code.txt (gitignored) and never printed.
// The old file is only read, never changed.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { createStorage } = require("../storage.js");
const { newCode, parseCode, formatCode, hashCode } = require("../visitor.js");

// Keeps the order the sets were done in: one second apart, from noon on their day.
function toRows(logs, visitor) {
  return logs.map((log, i) => ({
    id: log.id || crypto.randomUUID(),
    visitor_id: visitor,
    machine: log.machine,
    date: log.date,
    sets: log.sets || 1,
    reps: log.reps,
    weight: log.weight,
    created_at: new Date(Date.parse(`${log.date}T17:00:00Z`) + i * 1000).toISOString(),
  }));
}

async function importLogs({ storage, logFile, codeFile, confirm }) {
  const logs = JSON.parse(fs.readFileSync(logFile, "utf8"));
  if (!confirm) return { imported: 0, found: logs.length };

  // Save the code BEFORE writing, so the imported sets can never end up without a code.
  // If an earlier try failed, reuse its code.
  if (!fs.existsSync(codeFile)) fs.writeFileSync(codeFile, formatCode(newCode()) + "\n", { flag: "wx" });
  const code = parseCode(fs.readFileSync(codeFile, "utf8"));
  if (!code) throw new Error(`${codeFile} doesn't contain a valid code.`);

  const visitor = hashCode(code);
  if (await storage.hasLog(visitor)) throw new Error("This code already has sets. Nothing was imported.");
  const saved = await storage.importRows(toRows(logs, visitor)); // all rows or none
  return { imported: saved.length, found: logs.length };
}

if (require.main === module) {
  const root = path.join(__dirname, "..");
  try {
    process.loadEnvFile(path.join(root, ".env"));
  } catch {
    // No .env: createStorage reports what's missing
  }
  const confirm = process.argv.includes("--confirm");
  importLogs({
    storage: createStorage(),
    logFile: path.join(root, "data", "logs.json"),
    codeFile: path.join(root, "data", "my-log-code.txt"),
    confirm,
  })
    .then(({ imported, found }) =>
      console.log(confirm
        ? `Imported ${imported} of ${found} sets. Your code is in data/my-log-code.txt`
        : `Preview: ${found} sets would be imported. Nothing changed. Add --confirm to import.`))
    .catch((err) => {
      console.error("Import failed:", err.message);
      process.exitCode = 1;
    });
}

module.exports = { importLogs };
