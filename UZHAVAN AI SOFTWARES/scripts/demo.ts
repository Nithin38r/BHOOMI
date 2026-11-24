/**
 * One-command demo: builds the app, starts the hub server (which then serves the app itself),
 * starts the field simulator, and opens the landing page.
 *
 *   npm run demo                         drought scenario, fresh hub, 24 h of history
 *   npm run demo -- --scenario pondcrash any simulator flags replace the defaults
 *   npm run demo -- --no-build --no-open skip the build / don't open the browser
 *
 * Press the simulator keys (1-8, d, p, a, k, n) in this window; q stops everything.
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.PORT ?? 8080);
const URL = `http://localhost:${PORT}`;
const own = new Set(["--no-build", "--no-open"]);
const args = process.argv.slice(2);
const simArgs = args.filter(a => !own.has(a));
const NODE_FLAGS = ["--disable-warning=ExperimentalWarning"];

const up = async () => { try { await fetch(`${URL}/api/state`); return true; } catch { return false; } };

if (await up()) {
  console.error(`Something is already running on port ${PORT}. Stop it (or the other BHOOMI server) and run the demo again.`);
  process.exit(1);
}

if (!args.includes("--no-build")) {
  console.log("[demo] building the landing page and farmer app...");
  const b = spawnSync("npm", ["run", "build"], { cwd: root, stdio: "inherit", shell: true });
  if (b.status !== 0) process.exit(b.status ?? 1);
}

const children: ChildProcess[] = [];
const stopAll = (code = 0) => { for (const c of children) c.kill(); process.exit(code); };
process.on("SIGINT", () => stopAll(0));

// The demo gets its own database, started fresh each time, so old devices can't raise
// "not reporting" alerts on camera, and the normal dev database is left alone.
const DB = join(root, "server", "data", `demo-${PORT}.db`);
try {
  for (const f of [DB, `${DB}-wal`, `${DB}-shm`]) rmSync(f, { force: true });
} catch {
  console.error(`[demo] ${DB} is still open in another BHOOMI server. Close that terminal (or end its node.exe in Task Manager) and run the demo again.`);
  process.exit(1);
}

console.log("[demo] starting the hub server...");
const server = spawn(process.execPath, [...NODE_FLAGS, "server/src/index.ts"], { cwd: root, env: { ...process.env, DB_PATH: DB, BHOOMI_EXIT_WITH_PARENT: "1" }, stdio: ["pipe", "pipe", "pipe"] });
children.push(server);
const prefix = (s: NodeJS.ReadableStream, out: NodeJS.WriteStream) => {
  let buf = "";
  s.setEncoding("utf8");
  s.on("data", (d: string) => {
    buf += d;
    const lines = buf.split("\n"); buf = lines.pop() ?? "";
    for (const l of lines) out.write(`  hub │ ${l}\n`);
  });
};
prefix(server.stdout!, process.stdout);
prefix(server.stderr!, process.stderr);
server.on("exit", code => { console.error(`[demo] hub server stopped (code ${code}).`); stopAll(code ?? 1); });

for (let i = 0; !(await up()); i++) {
  if (i > 60) { console.error("[demo] the hub server did not start within 30 s."); stopAll(1); }
  await new Promise(r => setTimeout(r, 500));
}

console.log(`\n[demo] landing page : ${URL}/`);
console.log(`[demo] farmer app   : ${URL}/app/\n`);
if (!args.includes("--no-open")) {
  const opener = process.platform === "win32" ? ["cmd", ["/c", "start", "", `${URL}/`]] as const
    : process.platform === "darwin" ? ["open", [`${URL}/`]] as const
    : ["xdg-open", [`${URL}/`]] as const;
  spawn(opener[0], [...opener[1]], { stdio: "ignore", detached: true }).on("error", () => {}).unref();
}

const sim = spawn(process.execPath, [...NODE_FLAGS, "sim/sim.ts", ...(simArgs.length ? simArgs : ["--reset", "--scenario", "drought"])],
  { cwd: root, stdio: "inherit", env: process.env });
children.push(sim);
sim.on("exit", code => { server.removeAllListeners("exit"); console.log("[demo] stopped."); stopAll(code ?? 0); });
