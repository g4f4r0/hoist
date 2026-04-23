import path from "node:path";

import { Command } from "commander";

import { writeAgentConfig, writePublishedSkillBundle } from "../lib/agent-config.js";
import { outputError, outputProgress, outputResult } from "../lib/output.js";

export const skillsCommand = new Command("skills")
  .description("Manage Hoist agent skill files");

skillsCommand
  .command("sync")
  .description("Sync local Hoist skill files for supported agents")
  .action(() => {
    try {
      const written = writeAgentConfig();
      outputResult(
        { status: "synced", files: written },
        { actor: "agent", action: "Restart your agent so it reloads the updated Hoist skill." }
      );
    } catch (err) {
      outputError(
        "Failed to sync local skill files",
        err instanceof Error ? err.message : err
      );
      process.exit(1);
    }
  });

skillsCommand
  .command("export [dir]")
  .description("Write a publishable Hoist skill bundle")
  .action((dir?: string) => {
    const targetDir = dir ? path.resolve(dir) : path.join(process.cwd(), "skills", "hoist");

    try {
      outputProgress("skills", `Writing skill bundle to ${targetDir}`);
      const written = writePublishedSkillBundle(targetDir);
      outputResult(
        { status: "exported", dir: targetDir, files: written },
        { actor: "user", action: "Publish the bundle with `clawhub skill publish`." }
      );
    } catch (err) {
      outputError(
        "Failed to export skill bundle",
        err instanceof Error ? err.message : err
      );
      process.exit(1);
    }
  });
