const { execFileSync } = require("child_process");
const fs = require("fs");

const envPath = ".env.local";
const project = "puzzlecanvas";

function secret(name) {
  return execFileSync("firebase", ["functions:secrets:access", name, "--project", project], {
    encoding: "utf8"
  }).trim();
}

const updates = {
  APP_STORE_CONNECT_KEY_ID: secret("APPLE_IAP_KEY_ID"),
  APP_STORE_CONNECT_ISSUER_ID: secret("APPLE_IAP_ISSUER_ID"),
  APP_STORE_CONNECT_PRIVATE_KEY: `"${secret("APPLE_IAP_PRIVATE_KEY").replace(/\n/g, "\\n")}"`,
  PUZZLE_CANVAS_APPLE_APP_ID: secret("APPLE_APP_ID")
};

let env = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";
for (const [name, value] of Object.entries(updates)) {
  const line = `${name}=${value}`;
  const pattern = new RegExp(`^${name}=.*$`, "m");
  env = pattern.test(env) ? env.replace(pattern, line) : `${env}${env.endsWith("\n") || env.length === 0 ? "" : "\n"}${line}\n`;
}

fs.writeFileSync(envPath, env);
console.log("Puzzle Canvas App Store env set");
