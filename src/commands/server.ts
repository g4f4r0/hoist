import { spawn } from "node:child_process";
import { Command } from "commander";
import * as p from "@clack/prompts";
import chalk from "chalk";
import { getConfig, updateConfig, hasConfig } from "../lib/config.js";
import { readPublicKey, hasKeys, getPrivateKeyPath } from "../lib/ssh-keys.js";
import { getProvider, type ServerInfo } from "../providers/index.js";
import { setupServer, checkHealth } from "../lib/server-setup.js";
import { exec, execOrFail, closeConnection } from "../lib/ssh.js";
import { outputJson, outputError, outputSuccess, isJsonMode, isAutoYes } from "../lib/output.js";
import { getConfiguredProvider } from "../lib/server-resolve.js";
import { generateRandomName } from "../lib/random-name.js";

function hasSetup(): boolean {
  return hasConfig() && hasKeys();
}

export const serverCommand = new Command("server").description(
  "Manage servers"
);

serverCommand
  .command("create")
  .description("Provision a new VPS")
  .option("--name <name>", "Server name (random if omitted)")
  .option("--provider <provider>", "Provider label")
  .option("--type <type>", "Server type/plan (cheapest if omitted)")
  .option("--region <region>", "Server region (first available if omitted)")
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
      const json = opts.json || isJsonMode();
      const yes = opts.yes || isAutoYes();

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

      // Server name: use provided, prompt interactively, or generate random
      let serverName = opts.name;
      if (!serverName && !json && !yes) {
        const input = await p.text({
          message: "Server name:",
          placeholder: "leave empty for random name",
        });
        if (p.isCancel(input)) return;
        serverName = input || undefined;
      }
      if (!serverName) {
        serverName = generateRandomName();
      }

      // Region: use provided, auto-select first, or prompt
      let region = opts.region;
      if (!region) {
        const spinner = p.spinner();
        if (!json) spinner.start(`Fetching regions from ${label}...`);
        const regions = await provider.listRegions(providerConfig.apiKey);
        if (!json) spinner.stop(`${regions.length} regions available.`);

        if (json || yes) {
          // Auto-select first available region
          if (regions.length === 0) {
            outputError("No regions available from provider");
            process.exit(1);
          }
          region = regions[0].id;
        } else {
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
      }

      // Server type: use provided, auto-select cheapest, or prompt
      let serverType = opts.type;
      if (!serverType) {
        const spinner = p.spinner();
        if (!json) spinner.start(`Fetching server types from ${label}...`);
        const types = await provider.listServerTypes(providerConfig.apiKey);
        if (!json) spinner.stop(`${types.length} types available.`);

        if (json || yes) {
          // Auto-select cheapest (first in list)
          if (types.length === 0) {
            outputError("No server types available from provider");
            process.exit(1);
          }
          serverType = types[0].id;
        } else {
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
      }

      if (!yes && !json) {
        const confirmed = await p.confirm({
          message: `Create ${chalk.bold(serverType)} in ${chalk.bold(region)} on ${chalk.bold(label)} as "${chalk.bold(serverName)}"?`,
        });
        if (p.isCancel(confirmed) || !confirmed) return;
      }

      const spinner = p.spinner();
      if (!json) spinner.start("Provisioning server (this takes ~60s)...");

      let serverInfo: ServerInfo;
      try {
        serverInfo = await provider.createServer(providerConfig.apiKey, {
          name: serverName,
          type: serverType,
          region: region!,
          sshKeyPublic: readPublicKey(),
        });
      } catch (err) {
        if (!json) spinner.stop(chalk.red("Provisioning failed."));
        outputError(
          "Server creation failed",
          err instanceof Error ? err.message : err
        );
        process.exit(1);
      }

      if (!json)
        spinner.stop(
          `Server ${chalk.bold(serverName)} created at ${chalk.bold(serverInfo.ip)}`
        );

      if (!json) spinner.start("Setting up server (Docker, firewall, Caddy)...");

      const sshOpts = {
        host: serverInfo.ip!,
        port: 22,
        username: "root",
      };

      // SSH daemon needs time to start after provisioning
      await new Promise((resolve) => setTimeout(resolve, 10000));

      try {
        await setupServer(sshOpts, (msg) => {
          if (!json) spinner.message(msg);
        });
      } catch (err) {
        if (!json) spinner.stop(chalk.yellow("Setup had issues."));
        // Don't exit — server exists, setup can be retried
        outputError(
          "Server setup warning",
          err instanceof Error ? err.message : err
        );
      }

      try {
        const health = await checkHealth(sshOpts);
        if (!json)
          spinner.stop(
            health.healthy
              ? chalk.green("Server ready.")
              : chalk.yellow("Server created but some checks failed.")
          );
      } catch {
        if (!json) spinner.stop("Server created.");
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

      if (json) {
        outputJson(result);
      } else {
        outputSuccess(`Server "${serverName}" is ready at ${serverInfo.ip}`);
      }
    }
  );

serverCommand
  .command("import")
  .description("Import an existing server by IP address")
  .option("--name <name>", "Server name (random if omitted)")
  .option("--ip <ip>", "Server IP address")
  .option("--user <user>", "SSH user for initial connection", "root")
  .option("--json", "Output as JSON")
  .option("--yes", "Skip confirmations")
  .action(
    async (opts: {
      name?: string;
      ip?: string;
      user: string;
      json?: boolean;
      yes?: boolean;
    }) => {
      const json = opts.json || isJsonMode();
      const yes = opts.yes || isAutoYes();

      if (!hasSetup()) {
      outputError("Run 'hoist init' first.");
      process.exit(1);
    };

      // Server name: use provided or generate random
      let serverName = opts.name;
      if (!serverName && !json && !yes) {
        const input = await p.text({
          message: "Server name:",
          placeholder: "leave empty for random name",
        });
        if (p.isCancel(input)) return;
        serverName = input || undefined;
      }
      if (!serverName) {
        serverName = generateRandomName();
      }

      let ip = opts.ip;
      if (!ip && !json && !yes) {
        const input = await p.text({
          message: "Server IP address:",
          validate: (v) => (v.length === 0 ? "IP is required" : undefined),
        });
        if (p.isCancel(input)) return;
        ip = input;
      }
      if (!ip) {
        outputError("--ip is required");
        process.exit(1);
      }

      if (!yes && !json) {
        const confirmed = await p.confirm({
          message: `Import server ${chalk.bold(serverName)} at ${chalk.bold(ip)} as user ${chalk.bold(opts.user)}?`,
        });
        if (p.isCancel(confirmed) || !confirmed) return;
      }

      const sshOpts = {
        host: ip,
        port: 22,
        username: opts.user,
      };

      const spinner = p.spinner();

      if (!json) spinner.start("Testing SSH connection...");
      try {
        await exec(sshOpts, "echo ok");
      } catch (err) {
        if (!json) spinner.stop(chalk.red("SSH connection failed."));
        outputError(
          "Cannot connect to server",
          err instanceof Error ? err.message : err
        );
        process.exit(1);
      }
      if (!json) spinner.stop("SSH connection successful.");

      if (!json) spinner.start("Uploading SSH public key...");
      const publicKey = readPublicKey().replace(/'/g, "'\\''");
      try {
        await execOrFail(
          sshOpts,
          `mkdir -p ~/.ssh && echo '${publicKey}' >> ~/.ssh/authorized_keys && chmod 700 ~/.ssh && chmod 600 ~/.ssh/authorized_keys`
        );
      } catch (err) {
        if (!json) spinner.stop(chalk.red("Key upload failed."));
        outputError(
          "Failed to upload SSH key",
          err instanceof Error ? err.message : err
        );
        closeConnection(sshOpts);
        process.exit(1);
      }
      if (!json) spinner.stop("SSH public key uploaded.");

      if (!json) spinner.start("Setting up server (Docker, firewall, Caddy)...");
      closeConnection(sshOpts);
      const hoistSshOpts = {
        host: ip,
        port: 22,
        username: "root",
      };

      try {
        await setupServer(hoistSshOpts, (msg) => {
          if (!json) spinner.message(msg);
        });
      } catch (err) {
        if (!json) spinner.stop(chalk.yellow("Setup had issues."));
        outputError(
          "Server setup warning",
          err instanceof Error ? err.message : err
        );
      }

      try {
        const health = await checkHealth(hoistSshOpts);
        if (!json)
          spinner.stop(
            health.healthy
              ? chalk.green("Server ready.")
              : chalk.yellow("Server imported but some checks failed.")
          );
      } catch {
        if (!json) spinner.stop("Server imported.");
      }

      closeConnection(hoistSshOpts);

      const config = getConfig();
      if (!config.importedServers) config.importedServers = {};
      config.importedServers[serverName] = { ip, user: "root" };
      updateConfig(config);

      const result = {
        server: serverName,
        provider: "imported",
        ip,
        status: "ready",
      };

      if (json) {
        outputJson(result);
      } else {
        outputSuccess(`Server "${serverName}" imported and ready at ${ip}`);
      }
    }
  );

serverCommand
  .command("list")
  .description("List all servers")
  .option("--provider <provider>", "Provider label (default: all)")
  .option("--json", "Output as JSON")
  .action(async (opts: { provider?: string; json?: boolean }) => {
    const json = opts.json || isJsonMode();

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
        if (!json) {
          p.log.warning(
            `Failed to list servers from ${name}: ${err instanceof Error ? err.message : err}`
          );
        }
      }
    }

    if (!opts.provider && config.importedServers) {
      for (const [name, imported] of Object.entries(config.importedServers)) {
        allServers.push({
          id: name,
          name,
          status: "imported",
          ip: imported.ip,
          type: "",
          region: "",
          monthlyCost: "",
          provider: "imported",
        });
      }
    }

    if (json) {
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
      const json = opts.json || isJsonMode();

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

      if (!found && config.importedServers?.[name]) {
        const imported = config.importedServers[name];
        found = {
          id: name,
          name,
          status: "imported",
          ip: imported.ip,
          type: "",
          region: "",
          monthlyCost: "",
          provider: "imported",
        };
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

      if (json) {
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
      const json = opts.json || isJsonMode();
      const yes = opts.yes || isAutoYes();

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

      if (!found && config.importedServers?.[name]) {
        if (!yes && !json) {
          const confirmed = await p.confirm({
            message: `Remove imported server "${name}" from config?`,
          });
          if (p.isCancel(confirmed) || !confirmed) return;
        }
        delete config.importedServers[name];
        updateConfig(config);
        if (json) {
          outputJson({ status: "removed", server: name });
        } else {
          outputSuccess(`Imported server "${name}" removed from config.`);
        }
        return;
      }

      if (!found) {
        outputError(`Server "${name}" not found.`);
        process.exit(1);
      }

      if (!yes && !json) {
        const confirmed = await p.confirm({
          message: `Destroy server "${name}"? This cannot be undone.`,
        });
        if (p.isCancel(confirmed) || !confirmed) return;
      }

      const providerConfig = config.providers[found.provider];
      const provider = getProvider(providerConfig.type);

      const spinner = p.spinner();
      if (!json) spinner.start(`Destroying ${name}...`);

      try {
        await provider.deleteServer(providerConfig.apiKey, found.id);
        if (!json) spinner.stop(`Server "${name}" destroyed.`);
        if (json) {
          outputJson({ status: "destroyed", server: name });
        } else {
          outputSuccess(`Server "${name}" destroyed.`);
        }
      } catch (err) {
        if (!json) spinner.stop(chalk.red("Failed."));
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
    if (config.importedServers?.[name]) {
      ip = config.importedServers[name].ip;
    } else {
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
