import { Command } from "commander";

import { loadProjectConfig } from "../lib/project-config.js";
import { outputResult, outputError } from "../lib/output.js";

export const configCommand = new Command("config")
  .description("Manage project configuration");

configCommand
  .command("validate")
  .description("Validate hoist.json in the current directory")
  .action(() => {
    try {
      const config = loadProjectConfig();

      const serverCount = Object.keys(config.servers).length;
      const serviceCount = Object.keys(config.services).length;

      outputResult(
        { status: "valid", project: config.project, servers: serverCount, services: serviceCount },
        { actor: "agent", action: "Deploy the project.", command: "hoist deploy" }
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown validation error";
      outputError(message);
      process.exit(1);
    }
  });
