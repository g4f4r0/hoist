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
import { syncCommand } from "./commands/sync.js";
import { updateCommand } from "./commands/update.js";
import { keysCommand } from "./commands/keys.js";
import { configCommand } from "./commands/config.js";
import { closeAll } from "./lib/ssh.js";
import { checkForUpdate } from "./lib/version-check.js";

declare const __VERSION__: string;
const VERSION = __VERSION__;

const program = new Command();

program
  .name("hoist")
  .description(
    "Hoist your apps to production. Let your AI agent handle the rest."
  )
  .version(VERSION);

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
program.addCommand(syncCommand);
program.addCommand(updateCommand);
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

const updateCheck = checkForUpdate(VERSION);

program.parse();

updateCheck.then((result) => {
  if (result?.updateAvailable) {
    console.error(
      chalk.yellow(
        `\nUpdate available: ${result.current} \u2192 ${result.latest}\nRun: npm install -g hoist-cli`
      )
    );
  }
});
