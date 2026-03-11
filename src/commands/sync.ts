import { Command } from "commander";
import * as p from "@clack/prompts";
import chalk from "chalk";

import { writeAgentConfig } from "../lib/agent-config.js";
import { loadProjectConfig } from "../lib/project-config.js";
import { outputJson, outputError, outputSuccess } from "../lib/output.js";

export const syncCommand = new Command("sync")
  .description("Regenerate AI agent config files (AGENTS.md, skills) from hoist.json")
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
        outputJson({ synced: written, project: config?.project ?? null });
      } else {
        for (const file of written) {
          p.log.success(`${chalk.bold(file)} synced`);
        }
        outputSuccess(
          config
            ? `Agent config synced for project "${config.project}"`
            : "Agent config synced (no hoist.json found, wrote generic instructions)"
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
