import { Command } from "commander";
import * as p from "@clack/prompts";
import chalk from "chalk";

import { listTemplates, getTemplate } from "../lib/templates/index.js";
import { outputJson, outputError } from "../lib/output.js";

export const templateCommand = new Command("template").description(
  "Browse database templates"
);

templateCommand
  .command("list")
  .description("List all available templates")
  .option("--json", "Output as JSON")
  .action(async (opts: { json?: boolean }) => {
    const templates = listTemplates();

    if (opts.json) {
      outputJson(templates);
      return;
    }

    if (templates.length === 0) {
      p.log.info("No templates available.");
      return;
    }

    for (const t of templates) {
      p.log.info(`${chalk.bold(t.name)} — ${t.description}`);
    }
  });

templateCommand
  .command("info")
  .description("Show template details")
  .argument("<name>", "Template name")
  .option("--json", "Output as JSON")
  .action(async (name: string, opts: { json?: boolean }) => {
    let template;
    try {
      template = getTemplate(name);
    } catch {
      outputError(`Template "${name}" not found`);
      process.exit(3);
    }

    if (opts.json) {
      outputJson(template);
      return;
    }

    p.log.info(`${chalk.bold("Name:")}        ${template.name}`);
    p.log.info(`${chalk.bold("Description:")} ${template.description}`);
    p.log.info(`${chalk.bold("Image:")}       ${template.image}`);
    p.log.info(`${chalk.bold("Version:")}     ${template.defaultVersion}`);
    p.log.info(`${chalk.bold("Port:")}        ${template.port}`);

    const envKeys = Object.keys(template.env);
    if (envKeys.length > 0) {
      p.log.info(`${chalk.bold("Env vars:")}    ${envKeys.join(", ")}`);
    }

    const volumePaths = Object.keys(template.volumes);
    if (volumePaths.length > 0) {
      p.log.info(`${chalk.bold("Volumes:")}     ${volumePaths.join(", ")}`);
    }
  });
