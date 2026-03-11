declare const __VERSION__: string;

import { execSync } from "node:child_process";

import { Command } from "commander";
import * as p from "@clack/prompts";
import chalk from "chalk";

import { checkForUpdate } from "../lib/version-check.js";
import { outputJson, outputError, outputSuccess } from "../lib/output.js";

export const updateCommand = new Command("update")
  .description("Update hoist-cli to the latest version")
  .option("--json", "Output as JSON")
  .action(async (opts: { json?: boolean }) => {
    const current = __VERSION__;

    if (!opts.json) {
      const spinner = p.spinner();
      spinner.start("Checking for updates...");
      const result = await checkForUpdate(current);
      spinner.stop(
        result
          ? `Current: ${current}, Latest: ${result.latest}`
          : `Current: ${current}`
      );

      if (!result || !result.updateAvailable) {
        outputSuccess("Already on the latest version.");
        return;
      }

      p.log.info(
        `Update available: ${chalk.dim(current)} ${chalk.yellow("\u2192")} ${chalk.green(result.latest)}`
      );

      try {
        p.log.step("Running npm install -g hoist-cli...");
        execSync("npm install -g hoist-cli@latest", { stdio: "inherit" });
        outputSuccess(`Updated to ${result.latest}`);
      } catch (err) {
        outputError(
          "Update failed",
          err instanceof Error ? err.message : err
        );
        process.exit(1);
      }
    } else {
      const result = await checkForUpdate(current);
      if (!result) {
        outputJson({ current, latest: null, updateAvailable: false });
        return;
      }
      if (!result.updateAvailable) {
        outputJson({ current, latest: result.latest, updateAvailable: false });
        return;
      }

      try {
        execSync("npm install -g hoist-cli@latest", { stdio: "pipe" });
        outputJson({
          current,
          latest: result.latest,
          updateAvailable: true,
          updated: true,
        });
      } catch (err) {
        outputError(
          "Update failed",
          err instanceof Error ? err.message : err
        );
        process.exit(1);
      }
    }
  });
