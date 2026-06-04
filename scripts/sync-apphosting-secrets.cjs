const { spawnSync } = require("node:child_process");
const { mkdtempSync, readFileSync, rmSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");

const PROJECT = "app-performance-dashboard";
const BACKEND = "dashboard";
const LOCATION = "us-central1";

function parseEnv(text) {
  const values = {};

  for (const rawLine of text.split(/\n/)) {
    const line = rawLine.trimEnd();
    if (!line || line.trimStart().startsWith("#")) continue;

    const index = line.indexOf("=");
    if (index < 0) continue;

    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1);
    if ((value.startsWith('"') || value.startsWith("'")) && value.endsWith(value[0])) {
      value = value.slice(1, -1);
    }
    values[key] = value.replace(/\\n/g, "\n");
  }

  return values;
}

function run(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8", input: "\n", stdio: ["pipe", "pipe", "pipe"] });
  if (result.status !== 0) {
    const message = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
    throw new Error(`${command} ${args.join(" ")} failed\n${message}`);
  }
  return result.stdout;
}

function upsertSecret(name, value, tempDir) {
  const dataFile = join(tempDir, name);
  writeFileSync(dataFile, value, { mode: 0o600 });

  // --force creates the secret if needed, updates it if it already exists,
  // grants backend access, and keeps the command non-interactive.
  run("firebase", ["apphosting:secrets:set", name, "--project", PROJECT, "--data-file", dataFile, "--force"]);
}

function main() {
  const only = new Set(process.argv.slice(2));
  const yaml = readFileSync("apphosting.yaml", "utf8");
  const env = parseEnv(readFileSync(".env.local", "utf8"));
  const allNames = [...yaml.matchAll(/^\s+secret:\s*([A-Z0-9_]+)/gm)].map((match) => match[1]);
  const names = allNames.filter((name) => (only.size === 0 || only.has(name)) && env[name]);
  const missing = allNames.filter((name) => !env[name]);

  const tempDir = mkdtempSync(join(tmpdir(), "dashboard-apphosting-secrets-"));
  try {
    for (const name of names) {
      process.stdout.write(`Setting ${name}... `);
      upsertSecret(name, env[name], tempDir);
      process.stdout.write("ok\n");
    }

    if (names.length > 0) {
      run("firebase", [
        "apphosting:secrets:grantaccess",
        names.join(","),
        "--project",
        PROJECT,
        "--backend",
        BACKEND,
        "--location",
        LOCATION
      ]);
    }

    console.log(`Synced ${names.length} secret(s).`);
    if (missing.length > 0) {
      console.log(`Skipped ${missing.length} missing/empty secret(s): ${missing.join(", ")}`);
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

main();
