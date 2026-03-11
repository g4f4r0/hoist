import { Command } from "commander";
import * as p from "@clack/prompts";
import chalk from "chalk";

import { writeAgentConfig } from "../lib/agent-config.js";
import { loadProjectConfig } from "../lib/project-config.js";
import { outputJson, outputError, outputSuccess } from "../lib/output.js";

export const updateCommand = new Command("update")
  .description("Update AI agent configuration files for the current project")
  .option("--json", "Output as JSON")
  .action(async (opts: { json?: boolean }) => {
    const dir = process.cwd();

    let config;
    try {
      config = loadProjectConfig(dir);
    } catch {
      config = undefined;
    }

    try {
      const written = writeAgentConfig(dir, config);

      if (opts.json) {
        outputJson({ updated: written, project: config?.project ?? null });
      } else {
        for (const file of written) {
          p.log.success(`${chalk.bold(file)} updated`);
        }
        outputSuccess(
          config
            ? `Agent config updated for project "${config.project}"`
            : "Agent config updated (no hoist.json found, wrote generic instructions)"
        );
      }
    } catch (err) {
      outputError(
        "Failed to write agent config",
        err instanceof Error ? err.message : err
      );
      process.exit(1);
    }
  });
