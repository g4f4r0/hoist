import { Command } from "commander";

import { initCommand } from "./commands/init.js";
import { providerCommand } from "./commands/provider.js";
import { serverCommand } from "./commands/server.js";
import { doctorCommand } from "./commands/doctor.js";
import { deployCommand } from "./commands/deploy.js";
import { domainCommand } from "./commands/domain.js";
import { statusCommand } from "./commands/status.js";
import { dbCommand } from "./commands/db.js";
import { templateCommand } from "./commands/template.js";
import { envCommand } from "./commands/env.js";
import { logsCommand } from "./commands/logs.js";
import { rollbackCommand } from "./commands/rollback.js";
import { updateCommand } from "./commands/update.js";
import { closeAll } from "./lib/ssh.js";

const program = new Command();

program
  .name("hoist")
  .description(
    "Hoist your apps to production. Let your AI agent handle the rest."
  )
  .version("0.1.0");

program.addCommand(initCommand);
program.addCommand(providerCommand);
program.addCommand(serverCommand);
program.addCommand(doctorCommand);
program.addCommand(deployCommand);
program.addCommand(domainCommand);
program.addCommand(statusCommand);
program.addCommand(dbCommand);
program.addCommand(templateCommand);
program.addCommand(envCommand);
program.addCommand(logsCommand);
program.addCommand(rollbackCommand);
program.addCommand(updateCommand);

process.on("SIGINT", () => {
  closeAll();
  process.exit(130);
});
process.on("SIGTERM", () => {
  closeAll();
  process.exit(143);
});

program.parse();
