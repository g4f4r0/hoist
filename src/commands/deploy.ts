import { Command } from "commander";
import * as p from "@clack/prompts";
import chalk from "chalk";

import { loadProjectConfig, isAppService, type AppServiceConfig } from "../lib/project-config.js";
import { resolveServers } from "../lib/server-resolve.js";
import { closeConnection, type SSHConnectionOptions } from "../lib/ssh.js";
import { deployService } from "../lib/deploy.js";
import { outputJson, outputError, outputSuccess, isJsonMode, isAutoYes } from "../lib/output.js";

interface DeployResult {
  service: string;
  server: string;
  status: "running" | "failed";
  image: string;
  url: string;
  error?: string;
}

export const deployCommand = new Command("deploy")
  .description("Deploy services to servers")
  .option("--service <name>", "Deploy a specific service")
  .option("--repo <url>", "Deploy from a git repository URL")
  .option("--branch <branch>", "Git branch to deploy", "main")
  .option("--json", "Output as JSON")
  .option("--yes", "Skip confirmations")
  .action(async (opts: { service?: string; repo?: string; branch: string; json?: boolean; yes?: boolean }) => {
    const json = opts.json || isJsonMode();
    const yes = opts.yes || isAutoYes();

    let config;
    try {
      config = loadProjectConfig();
    } catch (err) {
      outputError(err instanceof Error ? err.message : "Failed to load project config");
      process.exit(1);
    }

    const appServices = Object.entries(config.services).filter(
      (entry): entry is [string, AppServiceConfig] => isAppService(entry[1])
    );

    if (appServices.length === 0) {
      outputError("No app services found in hoist.json");
      process.exit(1);
    }

    let servicesToDeploy: Array<[string, AppServiceConfig]>;

    if (opts.service) {
      const match = appServices.find(([name]) => name === opts.service);
      if (!match) {
        outputError(`Service "${opts.service}" not found or is not an app service`);
        process.exit(1);
      }
      servicesToDeploy = [match];
    } else if (appServices.length === 1) {
      // Single app service — auto-select
      servicesToDeploy = appServices;
    } else if (json || yes) {
      // Multiple services, non-interactive — deploy all
      servicesToDeploy = appServices;
    } else {
      const selected = await p.select({
        message: "Select a service to deploy:",
        options: appServices.map(([name, svc]) => ({
          value: name,
          label: `${name} → ${svc.server}${svc.domain ? ` (${svc.domain})` : ""}`,
        })),
      });
      if (p.isCancel(selected)) return;
      const match = appServices.find(([name]) => name === selected)!;
      servicesToDeploy = [match];
    }

    let resolved;
    try {
      resolved = await resolveServers(config.servers);
    } catch (err) {
      outputError(err instanceof Error ? err.message : "Failed to resolve servers");
      process.exit(1);
    }

    if (!yes && !json) {
      const lines = servicesToDeploy.map(([name, svc]) => {
        const server = resolved[svc.server];
        return `  ${chalk.bold(name)} → ${svc.server} (${server.ip})${svc.domain ? ` — ${svc.domain}` : ""}`;
      });
      const confirmed = await p.confirm({
        message: `Deploy the following?\n${lines.join("\n")}`,
      });
      if (p.isCancel(confirmed) || !confirmed) return;
    }

    const results: DeployResult[] = [];

    for (const [name, service] of servicesToDeploy) {
      const server = resolved[service.server];
      const ssh: SSHConnectionOptions = {
        host: server.ip,
        port: 22,
        username: "root",
      };

      const spinner = p.spinner();
      if (!json) spinner.start(`Deploying ${chalk.bold(name)}...`);

      try {
        const result = await deployService({
          ssh,
          serviceName: name,
          service,
          sourceDir: process.cwd(),
          repo: opts.repo,
          branch: opts.branch,
          onLog: (msg) => {
            if (!json) spinner.message(msg);
          },
        });
        if (!json) spinner.stop(chalk.green(`${name} deployed — ${result.status}`));
        results.push(result);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Deploy failed";
        if (!json) spinner.stop(chalk.red(`${name} failed: ${message}`));
        results.push({
          service: name,
          server: service.server,
          status: "failed",
          image: "",
          url: "",
          error: message,
        });
      } finally {
        closeConnection(ssh);
      }
    }

    const failed = results.filter((r) => r.status === "failed");

    if (json) {
      outputJson(results);
      if (failed.length > 0) process.exit(1);
      return;
    }

    if (failed.length > 0) {
      outputError(`${failed.length} service(s) failed to deploy`);
      process.exit(1);
    }

    outputSuccess(`${results.length} service(s) deployed successfully`);
  });
