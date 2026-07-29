import { spawnSync } from "node:child_process";
import process from "node:process";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const checks = [
  { name: "React tests", directory: "web-prototype", command: ["test"] },
  { name: "React build", directory: "web-prototype", command: ["run", "build"] },
  { name: "Cocos resources and contracts", directory: "cocos-client", command: ["run", "validate:a0"] },
  { name: "Pixel audit", directory: "cocos-client", command: ["run", "audit:image2"] },
];

const results = [];

for (const check of checks) {
  const cwd = path.join(root, check.directory);
  const label = `cd ${check.directory} && npm ${check.command.join(" ")}`;
  console.log(`\n> ${check.name}: ${label}`);

  const result = spawnSync(npmCommand, check.command, {
    cwd,
    stdio: "inherit",
    shell: false,
  });

  if (result.error) {
    console.error(`Failed to start ${label}: ${result.error.message}`);
    results.push({ name: check.name, status: 1, detail: `could not start: ${result.error.message}` });
    continue;
  }

  const status = result.status ?? 1;
  results.push({
    name: check.name,
    status,
    detail: result.signal ? `terminated by ${result.signal}` : `exit code ${status}`,
  });
}

console.log("\n=== Local quality gate summary ===");
for (const result of results) {
  console.log(`${result.status === 0 ? "PASS" : "FAIL"} ${result.name} (${result.detail})`);
}

if (results.some((result) => result.status !== 0)) {
  console.error("Local quality gate failed: one or more checks did not pass.");
  process.exitCode = 1;
} else {
  console.log("Local quality gate passed: all checks passed.");
}
