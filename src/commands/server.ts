import { spawn } from "node:child_process";
import { Command } from "commander";
import * as p from "@clack/prompts";
import chalk from "chalk";
import { getConfig, hasConfig } from "../lib/config.js";
import { readPublicKey, hasKeys, getPrivateKeyPath } from "../lib/ssh-keys.js";
import { getProvider, type ServerInfo } from "../providers/index.js";
import { setupServer, checkHealth } from "../lib/server-setup.js";
import { closeConnection } from "../lib/ssh.js";
import { outputJson, outputError, outputSuccess } from "../lib/output.js";
import { getConfiguredProvider } from "../lib/server-resolve.js";

function hasSetup(): boolean {
  return hasConfig() && hasKeys();
}

export const serverCommand = new Command("server").description(
  "Manage servers"
);

serverCommand
  .command("create")
  .description("Provision a new VPS")
  .option("--name <name>", "Server name")
  .option("--provider <provider>", "Provider label")
  .option("--type <type>", "Server type/plan")
  .option("--region <region>", "Server region")
  .option("--json", "Output as JSON")
  .option("--yes", "Skip confirmations")
  .action(
    async (opts: {
      name?: string;
      provider?: string;
      type?: string;
      region?: string;
      json?: boolean;
      yes?: boolean;
    }) => {
      if (!hasSetup()) {
      outputError("Run 'hoist init' first.");
      process.exit(1);
    };

      let resolved;
      try {
        resolved = getConfiguredProvider(opts.provider);
      } catch (err) {
        outputError(err instanceof Error ? err.message : "Provider error");
        process.exit(1);
      }
      const { label, providerConfig, provider } = resolved;

      let serverName = opts.name;
      if (!serverName && !opts.json) {
        const input = await p.text({
          message: "Server name:",
          placeholder: "main",
          validate: (v) => (v.length === 0 ? "Name is required" : undefined),
        });
        if (p.isCancel(input)) return;
        serverName = input;
      }
      if (!serverName) {
        outputError("--name is required");
        process.exit(1);
      }

      let region = opts.region;
      if (!region) {
        const spinner = p.spinner();
        spinner.start(`Fetching regions from ${label}...`);
        const regions = await provider.listRegions(providerConfig.apiKey);
        spinner.stop(`${regions.length} regions available.`);

        if (opts.json) {
          outputError("--region is required with --json");
          process.exit(1);
        }

        const selected = await p.select({
          message: "Region:",
          options: regions.map((r) => ({
            value: r.id,
            label: `${r.id} — ${r.city}, ${r.country}`,
          })),
        });
        if (p.isCancel(selected)) return;
        region = selected;
      }

      let serverType = opts.type;
      if (!serverType) {
        const spinner = p.spinner();
        spinner.start(`Fetching server types from ${label}...`);
        const types = await provider.listServerTypes(providerConfig.apiKey);
        spinner.stop(`${types.length} types available.`);

        if (opts.json) {
          outputError("--type is required with --json");
          process.exit(1);
        }

        const selected = await p.select({
          message: "Server type:",
          options: types.slice(0, 15).map((t) => ({
            value: t.id,
            label: `${t.id} — ${t.cpus} vCPU, ${t.memoryGb}GB RAM, ${t.diskGb}GB disk (${t.monthlyCost}/mo)`,
          })),
        });
        if (p.isCancel(selected)) return;
        serverType = selected;
      }

      if (!opts.yes && !opts.json) {
        const confirmed = await p.confirm({
          message: `Create ${chalk.bold(serverType)} in ${chalk.bold(region)} on ${chalk.bold(label)}?`,
        });
        if (p.isCancel(confirmed) || !confirmed) return;
      }

      const spinner = p.spinner();
      if (!opts.json) spinner.start("Provisioning server (this takes ~60s)...");

      let serverInfo: ServerInfo;
      try {
        serverInfo = await provider.createServer(providerConfig.apiKey, {
          name: serverName,
          type: serverType,
          region: region!,
          sshKeyPublic: readPublicKey(),
        });
      } catch (err) {
        if (!opts.json) spinner.stop(chalk.red("Provisioning failed."));
        outputError(
          "Server creation failed",
          err instanceof Error ? err.message : err
        );
        process.exit(1);
      }

      if (!opts.json)
        spinner.stop(
          `Server ${chalk.bold(serverName)} created at ${chalk.bold(serverInfo.ip)}`
        );

      if (!opts.json) spinner.start("Setting up server (Docker, firewall, Caddy)...");

      const sshOpts = {
        host: serverInfo.ip!,
        port: 22,
        username: "root",
      };

      // SSH daemon needs time to start after provisioning
      await new Promise((resolve) => setTimeout(resolve, 10000));

      try {
        await setupServer(sshOpts, (msg) => {
          if (!opts.json) spinner.message(msg);
        });
      } catch (err) {
        if (!opts.json) spinner.stop(chalk.yellow("Setup had issues."));
        // Don't exit — server exists, setup can be retried
        outputError(
          "Server setup warning",
          err instanceof Error ? err.message : err
        );
      }

      try {
        const health = await checkHealth(sshOpts);
        if (!opts.json)
          spinner.stop(
            health.healthy
              ? chalk.green("Server ready.")
              : chalk.yellow("Server created but some checks failed.")
          );
      } catch {
        if (!opts.json) spinner.stop("Server created.");
      }

      closeConnection(sshOpts);

      const result = {
        server: serverName,
        provider: label,
        ip: serverInfo.ip,
        type: serverType,
        region,
        status: "ready",
      };

      if (opts.json) {
        outputJson(result);
      } else {
        outputSuccess(`Server "${serverName}" is ready at ${serverInfo.ip}`);
      }
    }
  );

serverCommand
  .command("list")
  .description("List all servers")
  .option("--provider <provider>", "Provider label (default: all)")
  .option("--json", "Output as JSON")
  .action(async (opts: { provider?: string; json?: boolean }) => {
    if (!hasSetup()) {
      outputError("Run 'hoist init' first.");
      process.exit(1);
    };
    const config = getConfig();

    const labels = opts.provider
      ? [opts.provider]
      : Object.keys(config.providers);

    const allServers: Array<ServerInfo & { provider: string }> = [];

    for (const name of labels) {
      const providerConfig = config.providers[name];
      if (!providerConfig) {
        outputError(`Provider "${name}" not found.`);
        continue;
      }
      const provider = getProvider(providerConfig.type);
      try {
        const servers = await provider.listServers(providerConfig.apiKey);
        for (const server of servers) {
          allServers.push({ ...server, provider: name });
        }
      } catch (err) {
        if (!opts.json) {
          p.log.warning(
            `Failed to list servers from ${name}: ${err instanceof Error ? err.message : err}`
          );
        }
      }
    }

    if (opts.json) {
      outputJson(allServers);
      return;
    }

    if (allServers.length === 0) {
      p.log.info("No servers found. Create one with: hoist server create");
      return;
    }

    for (const server of allServers) {
      const statusColor =
        server.status === "running"
          ? chalk.green(server.status)
          : chalk.yellow(server.status);
      p.log.info(
        `${chalk.bold(server.name)} ${chalk.dim(server.provider)} ${server.ip || "no IP"} ${statusColor} ${chalk.dim(server.type + " / " + server.region)}`
      );
    }
  });

serverCommand
  .command("status")
  .description("Server details and health")
  .argument("<name>", "Server name")
  .option("--provider <provider>", "Provider label")
  .option("--json", "Output as JSON")
  .action(
    async (
      name: string,
      opts: { provider?: string; json?: boolean }
    ) => {
      if (!hasSetup()) {
      outputError("Run 'hoist init' first.");
      process.exit(1);
    };
      const config = getConfig();

      const labels = opts.provider
        ? [opts.provider]
        : Object.keys(config.providers);

      let found: (ServerInfo & { provider: string }) | null = null;
      for (const providerName of labels) {
        const providerConfig = config.providers[providerName];
        if (!providerConfig) continue;
        const provider = getProvider(providerConfig.type);
        const servers = await provider.listServers(providerConfig.apiKey);
        const match = servers.find((s) => s.name === name);
        if (match) {
          found = { ...match, provider: providerName };
          break;
        }
      }

      if (!found) {
        outputError(`Server "${name}" not found.`);
        process.exit(1);
      }

      let health: { healthy: boolean; details: string[] } | null = null;
      if (found.ip) {
        try {
          const sshOpts = { host: found.ip, port: 22, username: "root" };
          health = await checkHealth(sshOpts);
          closeConnection(sshOpts);
        } catch {
          health = { healthy: false, details: ["SSH connection failed"] };
        }
      }

      const result = {
        ...found,
        health: health
          ? { healthy: health.healthy, checks: health.details }
          : null,
      };

      if (opts.json) {
        outputJson(result);
        return;
      }

      p.log.info(`${chalk.bold("Name:")}     ${found.name}`);
      p.log.info(`${chalk.bold("Provider:")} ${found.provider}`);
      p.log.info(`${chalk.bold("IP:")}       ${found.ip || "none"}`);
      p.log.info(`${chalk.bold("Type:")}     ${found.type}`);
      p.log.info(`${chalk.bold("Region:")}   ${found.region}`);
      p.log.info(`${chalk.bold("Status:")}   ${found.status}`);

      if (health) {
        p.log.info("");
        p.log.info(
          chalk.bold("Health:") +
            " " +
            (health.healthy ? chalk.green("healthy") : chalk.red("unhealthy"))
        );
        for (const detail of health.details) {
          p.log.info(`  ${detail}`);
        }
      }
    }
  );

serverCommand
  .command("destroy")
  .description("Delete a server")
  .argument("<name>", "Server name")
  .option("--provider <provider>", "Provider label")
  .option("--yes", "Skip confirmation")
  .option("--json", "Output as JSON")
  .action(
    async (
      name: string,
      opts: { provider?: string; yes?: boolean; json?: boolean }
    ) => {
      if (!hasSetup()) {
      outputError("Run 'hoist init' first.");
      process.exit(1);
    };
      const config = getConfig();

      const labels = opts.provider
        ? [opts.provider]
        : Object.keys(config.providers);

      let found: { id: string; provider: string } | null = null;
      for (const providerName of labels) {
        const providerConfig = config.providers[providerName];
        if (!providerConfig) continue;
        const provider = getProvider(providerConfig.type);
        const servers = await provider.listServers(providerConfig.apiKey);
        const match = servers.find((s) => s.name === name);
        if (match) {
          found = { id: match.id, provider: providerName };
          break;
        }
      }

      if (!found) {
        outputError(`Server "${name}" not found.`);
        process.exit(1);
      }

      if (!opts.yes && !opts.json) {
        const confirmed = await p.confirm({
          message: `Destroy server "${name}"? This cannot be undone.`,
        });
        if (p.isCancel(confirmed) || !confirmed) return;
      }

      const providerConfig = config.providers[found.provider];
      const provider = getProvider(providerConfig.type);

      const spinner = p.spinner();
      if (!opts.json) spinner.start(`Destroying ${name}...`);

      try {
        await provider.deleteServer(providerConfig.apiKey, found.id);
        if (!opts.json) spinner.stop(`Server "${name}" destroyed.`);
        if (opts.json) {
          outputJson({ status: "destroyed", server: name });
        } else {
          outputSuccess(`Server "${name}" destroyed.`);
        }
      } catch (err) {
        if (!opts.json) spinner.stop(chalk.red("Failed."));
        outputError(
          `Failed to destroy "${name}"`,
          err instanceof Error ? err.message : err
        );
        process.exit(1);
      }
    }
  );

serverCommand
  .command("ssh")
  .description("Open SSH session to a server")
  .argument("<name>", "Server name")
  .option("--provider <provider>", "Provider label")
  .action(async (name: string, opts: { provider?: string }) => {
    if (!hasSetup()) {
      outputError("Run 'hoist init' first.");
      process.exit(1);
    };
    const config = getConfig();

    const labels = opts.provider
      ? [opts.provider]
      : Object.keys(config.providers);

    let ip = "";
    for (const providerName of labels) {
      const providerConfig = config.providers[providerName];
      if (!providerConfig) continue;
      const provider = getProvider(providerConfig.type);
      const servers = await provider.listServers(providerConfig.apiKey);
      const match = servers.find((s) => s.name === name);
      if (match?.ip) {
        ip = match.ip;
        break;
      }
    }

    if (!ip) {
      outputError(`Server "${name}" not found or has no IP.`);
      process.exit(1);
    }

    const keyPath = getPrivateKeyPath();
    const child = spawn(
      "ssh",
      ["-i", keyPath, "-o", "StrictHostKeyChecking=accept-new", `root@${ip}`],
      { stdio: "inherit" }
    );

    child.on("exit", (code) => {
      process.exit(code ?? 0);
    });
  });
