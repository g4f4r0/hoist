import { Command } from "commander";
import { initCommand } from "./commands/init.js";
import { providerCommand } from "./commands/provider.js";
import { serverCommand } from "./commands/server.js";
import { doctorCommand } from "./commands/doctor.js";

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

program.parse();
