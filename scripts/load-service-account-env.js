const fs = require("fs");

const [, , prefix, keyPath] = process.argv;

if (!prefix || !keyPath) {
  throw new Error("Usage: node scripts/load-service-account-env.js PREFIX path/to/key.json");
}

const envPath = ".env.local";
const key = JSON.parse(fs.readFileSync(keyPath, "utf8"));
const updates = {
  [`${prefix}_FIREBASE_PROJECT_ID`]: key.project_id,
  [`${prefix}_FIREBASE_CLIENT_EMAIL`]: key.client_email,
  [`${prefix}_FIREBASE_PRIVATE_KEY`]: `"${key.private_key.replace(/\n/g, "\\n")}"`
};

let env = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";
for (const [name, value] of Object.entries(updates)) {
  const line = `${name}=${value}`;
  const pattern = new RegExp(`^${name}=.*$`, "m");
  env = pattern.test(env) ? env.replace(pattern, line) : `${env}${env.endsWith("\n") || env.length === 0 ? "" : "\n"}${line}\n`;
}

fs.writeFileSync(envPath, env);
console.log(`${prefix} service account env set`);
