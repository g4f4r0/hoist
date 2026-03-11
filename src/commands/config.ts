import { Command } from "commander";

import { loadProjectConfig } from "../lib/project-config.js";
import { outputSuccess, outputError, isJsonMode } from "../lib/output.js";

export const configCommand = new Command("config")
  .description("Manage project configuration");

configCommand
  .command("validate")
  .description("Validate hoist.json in the current directory")
  .action(() => {
    const json = isJsonMode();

    try {
      const config = loadProjectConfig();

      const serverCount = Object.keys(config.servers).length;
      const serviceCount = Object.keys(config.services).length;

      outputSuccess(
        `hoist.json is valid — project "${config.project}" with ${serverCount} server(s) and ${serviceCount} service(s)`,
        json
          ? {
              project: config.project,
              servers: serverCount,
              services: serviceCount,
            }
          : undefined,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown validation error";
      outputError(message);
      process.exit(1);
    }
  });
