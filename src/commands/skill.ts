import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execSync } from "node:child_process";

import { Command } from "commander";
import * as p from "@clack/prompts";
import chalk from "chalk";

import {
  generateSkillContent,
  generateCommandsReference,
  generateDockerfileReference,
} from "../lib/agent-config.js";
import { outputJson, outputError, outputSuccess, isJsonMode } from "../lib/output.js";

function buildSkillMd(name: string, description: string, version: string): string {
  const frontmatter = [
    "---",
    `name: ${name}`,
    `description: ${description}`,
    `version: ${version}`,
    "metadata:",
    "  openclaw:",
    "    requires:",
    '      bins: ["hoist"]',
    "---",
    "",
  ].join("\n");

  return frontmatter + generateSkillContent();
}

function hasZip(): boolean {
  try {
    execSync("which zip", { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

export const skillCommand = new Command("skill")
  .description("Export skill for publishing to ClawHub or other registries");

skillCommand
  .command("export")
  .description("Export the Hoist skill as an archive ready for publishing")
  .option("--name <name>", "Skill name", "hoist")
  .option("--skill-version <version>", "Skill version", "1.0.0")
  .option("-o, --output <path>", "Output directory", ".")
  .action(
    async (opts: {
      name: string;
      skillVersion: string;
      output: string;
    }) => {
      const version = opts.skillVersion;
      const description =
        "Deploys and manages apps, servers, databases, domains, and environment variables on VPS providers (Hetzner, Vultr, DigitalOcean) using the Hoist CLI.";

      const useZip = hasZip();
      const ext = useZip ? "zip" : "tar.gz";
      const archiveName = `${opts.name}-skill-v${version}.${ext}`;
      const outputDir = path.resolve(opts.output);
      const outputPath = path.join(outputDir, archiveName);

      const skillMd = buildSkillMd(opts.name, description, version);
      const commandsMd = generateCommandsReference();
      const dockerfilesMd = generateDockerfileReference();

      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hoist-skill-"));
      const files = "SKILL.md COMMANDS.md DOCKERFILES.md";

      try {
        fs.writeFileSync(path.join(tmpDir, "SKILL.md"), skillMd, "utf-8");
        fs.writeFileSync(path.join(tmpDir, "COMMANDS.md"), commandsMd, "utf-8");
        fs.writeFileSync(path.join(tmpDir, "DOCKERFILES.md"), dockerfilesMd, "utf-8");

        if (useZip) {
          execSync(`cd "${tmpDir}" && zip -j "${outputPath}" ${files}`, {
            stdio: "pipe",
          });
        } else {
          execSync(`cd "${tmpDir}" && tar czf "${outputPath}" ${files}`, {
            stdio: "pipe",
          });
        }

        if ((isJsonMode())) {
          outputJson({
            exported: outputPath,
            name: opts.name,
            version,
            files: ["SKILL.md", "COMMANDS.md", "DOCKERFILES.md"],
          });
        } else {
          p.log.success(`${chalk.bold("SKILL.md")} generated`);
          p.log.success(`${chalk.bold("COMMANDS.md")} generated`);
          outputSuccess(`Exported to ${chalk.bold(outputPath)}`);
          if (useZip) {
            p.log.info(
              `Publish to ClawHub: ${chalk.dim(`clawhub publish ${outputPath}`)}`
            );
          }
        }
      } catch (err) {
        outputError(
          "Failed to export skill",
          err instanceof Error ? err.message : err
        );
        process.exit(1);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    }
  );
