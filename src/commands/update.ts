declare const __VERSION__: string;

import { execSync } from "node:child_process";

import { Command } from "commander";

import { checkForUpdate } from "../lib/version-check.js";
import { writeAgentConfig } from "../lib/agent-config.js";
import { outputResult, outputError, outputProgress } from "../lib/output.js";

export const updateCommand = new Command("update")
  .description("Update agent skill files and check for CLI updates")
  .action(async () => {
    const current = __VERSION__;

    try {
      const written = writeAgentConfig();
      outputProgress("update", `${written.length} skill files synced`);
    } catch (err) {
      outputError(
        "Failed to write agent skill files",
        err instanceof Error ? err.message : err
      );
      process.exit(1);
    }

    const result = await checkForUpdate(current);
    if (!result || !result.updateAvailable) {
      outputResult(
        { skills: "updated", cli: { current, latest: result?.latest ?? current, updated: false } },
        { actor: "agent", action: "Restart the agent to pick up new skills." }
      );
      return;
    }

    try {
      execSync("npm install -g hoist-cli@latest", { stdio: "pipe" });
      outputResult(
        { skills: "updated", cli: { current, latest: result.latest, updated: true } },
        { actor: "agent", action: "Restart the agent to pick up new skills." }
      );
    } catch (err) {
      outputError(
        "CLI update failed",
        err instanceof Error ? err.message : err
      );
      process.exit(1);
    }
  });
