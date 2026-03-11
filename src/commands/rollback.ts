import { Command } from "commander";
import * as p from "@clack/prompts";
import chalk from "chalk";

import { loadProjectConfig, isAppService, getOnlyAppService, type AppServiceConfig } from "../lib/project-config.js";
import { resolveServers } from "../lib/server-resolve.js";
import { exec, execOrFail, closeConnection, type SSHConnectionOptions } from "../lib/ssh.js";
import { containerName, imageName, buildDockerRunCmd, checkContainerHealth } from "../lib/container.js";
import { listEnv } from "../lib/container-env.js";
import { updateRouteUpstream } from "../lib/caddy.js";
import { outputJson, outputError, outputSuccess, isJsonMode, isAutoYes } from "../lib/output.js";

interface RollbackResult {
  service: string;
  server: string;
  status: "rolled-back" | "failed";
  image: string;
  url: string;
  error?: string;
}

async function hasPreviousImage(
  ssh: SSHConnectionOptions,
  serviceName: string
): Promise<boolean> {
  const result = await exec(
    ssh,
    `docker image inspect ${imageName(serviceName)}:previous 2>/dev/null`
  );
  return result.code === 0;
}

async function rollbackService(
  ssh: SSHConnectionOptions,
  serviceName: string,
  service: AppServiceConfig,
  onLog?: (msg: string) => void
): Promise<void> {
  const log = onLog ?? (() => {});
  const name = containerName(serviceName);
  const image = imageName(serviceName);

  log("Checking for previous image");
  const exists = await hasPreviousImage(ssh, serviceName);
  if (!exists) {
    throw new Error(`No previous image found for ${serviceName}. Nothing to roll back to.`);
  }

  const containerExists = (await exec(ssh, `docker inspect ${name} 2>/dev/null`)).code === 0;

  let env: Record<string, string> = {};
  if (containerExists) {
    log("Reading current container environment");
    env = await listEnv(ssh, serviceName);

    log("Stopping current container");
    await execOrFail(ssh, `docker stop ${name}`);
    await execOrFail(ssh, `docker rm ${name}`);
  } else {
    log("No running container found, starting fresh from previous image");
  }

  log("Swapping image tags");
  const hasLatest = (await exec(ssh, `docker image inspect ${image}:latest 2>/dev/null`)).code === 0;
  if (hasLatest) {
    await execOrFail(ssh, `docker tag ${image}:latest ${image}:rollback-backup`);
    await execOrFail(ssh, `docker tag ${image}:previous ${image}:latest`);
    await execOrFail(ssh, `docker tag ${image}:rollback-backup ${image}:previous`);
    await exec(ssh, `docker rmi ${image}:rollback-backup`);
  } else {
    await execOrFail(ssh, `docker tag ${image}:previous ${image}:latest`);
  }

  log("Starting container from previous image");
  await execOrFail(ssh, buildDockerRunCmd(name, `${image}:latest`, env));

  log("Verifying container is running");
  const inspect = await exec(ssh, `docker inspect --format '{{.State.Running}}' ${name}`);
  if (inspect.code !== 0 || inspect.stdout.trim() !== "true") {
    throw new Error(`Container ${name} failed to start after rollback`);
  }

  log("Checking container health");
  await checkContainerHealth(ssh, name, service.port, service.healthCheck);

  if (service.domain) {
    log(`Updating Caddy route to ${name}:${service.port}`);
    await updateRouteUpstream(ssh, service.domain, `${name}:${service.port}`);
  }
}

export const rollbackCommand = new Command("rollback")
  .description("Roll back a service to its previous deployment")
  .option("--service <name>", "Service to roll back")
  .option("--server <server>", "Server name filter")
  .option("--json", "Output as JSON")
  .option("--yes", "Skip confirmations")
  .action(async (opts: { service?: string; server?: string; json?: boolean; yes?: boolean }) => {
    const json = opts.json || isJsonMode();
    const yes = opts.yes || isAutoYes();

    let config;
    try {
      config = loadProjectConfig();
    } catch (err) {
      outputError(err instanceof Error ? err.message : "Failed to load project config");
      process.exit(1);
    }

    let appServices = Object.entries(config.services).filter(
      (entry): entry is [string, AppServiceConfig] => isAppService(entry[1])
    );

    if (opts.server) {
      appServices = appServices.filter(([, svc]) => svc.server === opts.server);
    }

    if (appServices.length === 0) {
      outputError("No app services found in hoist.json");
      process.exit(1);
    }

    let target: [string, AppServiceConfig];

    if (opts.service) {
      const match = appServices.find(([name]) => name === opts.service);
      if (!match) {
        outputError(`Service "${opts.service}" not found or is not an app service`);
        process.exit(1);
      }
      target = match;
    } else if (appServices.length === 1) {
      // Single app service — auto-select
      target = appServices[0];
    } else if (json || yes) {
      outputError("Multiple app services found. Use --service to specify one.");
      process.exit(1);
    } else {
      const selected = await p.select({
        message: "Select a service to roll back:",
        options: appServices.map(([name, svc]) => ({
          value: name,
          label: `${name} → ${svc.server}${svc.domain ? ` (${svc.domain})` : ""}`,
        })),
      });
      if (p.isCancel(selected)) return;
      target = appServices.find(([name]) => name === selected)!;
    }

    const [serviceName, service] = target;

    let resolved;
    try {
      resolved = await resolveServers(config.servers);
    } catch (err) {
      outputError(err instanceof Error ? err.message : "Failed to resolve servers");
      process.exit(1);
    }

    const server = resolved[service.server];
    const ssh: SSHConnectionOptions = {
      host: server.ip,
      port: 22,
      username: "root",
    };

    if (!yes && !json) {
      const confirmed = await p.confirm({
        message: `Roll back ${chalk.bold(serviceName)} on ${service.server} (${server.ip}) to its previous image?`,
      });
      if (p.isCancel(confirmed) || !confirmed) return;
    }

    const spinner = p.spinner();
    if (!json) spinner.start(`Rolling back ${chalk.bold(serviceName)}...`);

    try {
      await rollbackService(ssh, serviceName, service, (msg) => {
        if (!json) spinner.message(msg);
      });

      const url = service.domain ? `https://${service.domain}` : `http://${ssh.host}:${service.port}`;

      if (!json) {
        spinner.stop(chalk.green(`${serviceName} rolled back successfully`));
      }

      const result: RollbackResult = {
        service: serviceName,
        server: service.server,
        status: "rolled-back",
        image: `${imageName(serviceName)}:latest`,
        url,
      };

      if (json) {
        outputJson(result);
      } else {
        outputSuccess(`${serviceName} rolled back to previous image`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Rollback failed";
      if (!json) spinner.stop(chalk.red(`${serviceName} failed: ${message}`));

      const result: RollbackResult = {
        service: serviceName,
        server: service.server,
        status: "failed",
        image: "",
        url: "",
        error: message,
      };

      if (json) {
        outputJson(result);
      } else {
        outputError(message);
      }
      process.exit(1);
    } finally {
      closeConnection(ssh);
    }
  });
