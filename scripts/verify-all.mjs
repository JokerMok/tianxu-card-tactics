import { spawnSync } from "node:child_process";
import process from "node:process";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const checks = [
  { directory: "web-prototype", command: ["test"] },
  { directory: "web-prototype", command: ["run", "build"] },
  { directory: "cocos-client", command: ["run", "validate:a0"] },
];

for (const check of checks) {
  const cwd = path.join(root, check.directory);
  const label = `cd ${check.directory} && npm ${check.command.join(" ")}`;
  console.log(`\n> ${label}`);

  const result = spawnSync(npmCommand, check.command, {
    cwd,
    stdio: "inherit",
    shell: false,
  });

  if (result.error) {
    console.error(`Failed to start ${label}: ${result.error.message}`);
    process.exit(1);
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
