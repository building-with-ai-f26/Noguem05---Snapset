// Starts a real SnapSet server against a fake Supabase, for one test.
const { spawn } = require("child_process");
const path = require("path");
const { startFakeSupabase } = require("./fake-supabase.js");

async function startServer(t, { broken = false, env = {} } = {}) {
  const db = await startFakeSupabase({ broken });
  t.after(() => db.close());
  const child = spawn(process.execPath, [path.join(__dirname, "..", "server.js")], {
    // These override .env, so tests can't reach the real database or the paid AI
    env: { ...process.env, PORT: "0", OPENROUTER_API_KEY: "", RENDER: "", ...db.env, ...env },
  });
  t.after(() => child.kill());
  let errors = "";
  child.stderr.on("data", (chunk) => (errors += chunk));
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("server didn't start: " + errors)), 5000);
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
  return { port, call, db };
}

module.exports = { startServer };
