declare const __VERSION__: string;

import { execSync } from "node:child_process";

import { Command } from "commander";
import * as p from "@clack/prompts";
import chalk from "chalk";

import { checkForUpdate } from "../lib/version-check.js";
import { writeAgentConfig } from "../lib/agent-config.js";
import { outputJson, outputError, outputSuccess } from "../lib/output.js";

export const updateCommand = new Command("update")
  .description("Update agent skill files and check for CLI updates")
  .option("--json", "Output as JSON")
  .action(async (opts: { json?: boolean }) => {
    const current = __VERSION__;

    // 1. Update skill files
    try {
      const written = writeAgentConfig();

      if (!opts.json) {
        for (const file of written) {
          p.log.success(`${chalk.bold(file)} synced`);
        }
      }
    } catch (err) {
      outputError(
        "Failed to write agent skill files",
        err instanceof Error ? err.message : err
      );
      process.exit(1);
    }

    // 2. Check for CLI updates
    if (!opts.json) {
      const spinner = p.spinner();
      spinner.start("Checking for CLI updates...");
      const result = await checkForUpdate(current);
      spinner.stop(
        result
          ? `Current: ${current}, Latest: ${result.latest}`
          : `Current: ${current}`
      );

      if (!result || !result.updateAvailable) {
        outputSuccess("Skills updated. CLI already on the latest version.");
        p.log.info(chalk.dim("Restart your AI agent to pick up the new skills."));
        return;
      }

      p.log.info(
        `Update available: ${chalk.dim(current)} ${chalk.yellow("\u2192")} ${chalk.green(result.latest)}`
      );

      try {
        p.log.step("Running npm install -g hoist-cli...");
        execSync("npm install -g hoist-cli@latest", { stdio: "inherit" });
        outputSuccess(`Skills updated. CLI updated to ${result.latest}.`);
        p.log.info(chalk.dim("Restart your AI agent to pick up the new skills."));
      } catch (err) {
        outputError(
          "CLI update failed",
          err instanceof Error ? err.message : err
        );
        process.exit(1);
      }
    } else {
      const result = await checkForUpdate(current);
      if (!result || !result.updateAvailable) {
        outputJson({
          skills: "updated",
          restart: "Restart your AI agent to pick up the new skills.",
          cli: { current, latest: result?.latest ?? current, updated: false },
        });
        return;
      }

      try {
        execSync("npm install -g hoist-cli@latest", { stdio: "pipe" });
        outputJson({
          skills: "updated",
          restart: "Restart your AI agent to pick up the new skills.",
          cli: { current, latest: result.latest, updated: true },
        });
      } catch (err) {
        outputError(
          "CLI update failed",
          err instanceof Error ? err.message : err
        );
        process.exit(1);
      }
    }
  });
