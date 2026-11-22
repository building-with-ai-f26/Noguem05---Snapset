// Read-only: copies every database row into data/backups/ (gitignored).
//   node scripts/backup-db.js
// Run it before any change to the database.

const fs = require("fs");
const path = require("path");
const { createStorage } = require("../storage.js");

try {
  process.loadEnvFile(path.join(__dirname, "..", ".env"));
} catch {
  // No .env: createStorage reports what's missing
}

async function main() {
  const rows = await createStorage().exportAll();
  const dir = path.join(__dirname, "..", "data", "backups");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `db-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(file, JSON.stringify(rows, null, 2), { flag: "wx" }); // never overwrite a backup
  const readBack = JSON.parse(fs.readFileSync(file, "utf8")).length;
  if (readBack !== rows.length) throw new Error("The backup doesn't match the database.");
  console.log(`Backed up ${readBack} rows to ${file}`);
}

main().catch((err) => {
  console.error("Backup failed:", err.message);
  process.exitCode = 1;
});
