import { Command } from "commander";
import chalk from "chalk";

import { initCommand } from "./commands/init.js";
import { providerCommand } from "./commands/provider.js";
import { serverCommand } from "./commands/server.js";
import { doctorCommand } from "./commands/doctor.js";
import { deployCommand } from "./commands/deploy.js";
import { domainCommand } from "./commands/domain.js";
import { statusCommand } from "./commands/status.js";
import { templateCommand } from "./commands/template.js";
import { envCommand } from "./commands/env.js";
import { logsCommand } from "./commands/logs.js";
import { rollbackCommand } from "./commands/rollback.js";
import { keysCommand } from "./commands/keys.js";
import { configCommand } from "./commands/config.js";
import { closeAll } from "./lib/ssh.js";
import { showStatus } from "./lib/status-check.js";
import { outputProgress } from "./lib/output.js";
import { checkForUpdate } from "./lib/version-check.js";

declare const __VERSION__: string;
const VERSION = __VERSION__;

const program = new Command();

program
  .name("hoist")
  .description(
    "Hoist your apps to production. Let your AI agent handle the rest."
  )
  .version(VERSION)
  .option("--status", "Show version, auth, and provider status");

program.addCommand(initCommand);
program.addCommand(providerCommand);
program.addCommand(serverCommand);
program.addCommand(doctorCommand);
program.addCommand(deployCommand);
program.addCommand(domainCommand);
program.addCommand(statusCommand);
program.addCommand(templateCommand);
program.addCommand(envCommand);
program.addCommand(logsCommand);
program.addCommand(rollbackCommand);
program.addCommand(keysCommand);
program.addCommand(configCommand);

process.on("SIGINT", () => {
  closeAll();
  process.exit(130);
});
process.on("SIGTERM", () => {
  closeAll();
  process.exit(143);
});

if (process.stderr.isTTY) {
  const taglines = [
    "your agent's favorite ops tool.",
    "because you have better things to do than SSH.",
    "infrastructure that doesn't need a PhD.",
    "your YAML days are over.",
  ];
  const tagline = taglines[Math.floor(Math.random() * taglines.length)];
  process.stderr.write(`${chalk.bold("Hoist")} ${chalk.dim(VERSION)} ${chalk.dim("—")} ${tagline}\n\n`);
}

if (process.argv.includes("--status")) {
  await showStatus(VERSION);
  process.exit(0);
}

const updateCheck = checkForUpdate(VERSION);

program.parse();

updateCheck.then((result) => {
  if (result?.updateAvailable) {
    outputProgress("update", `Update available: ${result.current} → ${result.latest}. Run: npm install -g hoist-cli`);
  }
});
