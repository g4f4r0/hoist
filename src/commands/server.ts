import { spawn } from "node:child_process";

import { Command } from "commander";

import { getConfig, updateConfig, hasConfig } from "../lib/config.js";
import { readPublicKey, hasKeys, getPrivateKeyPath } from "../lib/ssh-keys.js";
import { getProvider, type ServerInfo, type RegionInfo } from "../providers/index.js";
import { setupServer, checkHealth } from "../lib/server-setup.js";
import { exec, execOrFail, closeConnection } from "../lib/ssh.js";
import { outputResult, outputError, outputProgress } from "../lib/output.js";
import { getConfiguredProvider } from "../lib/server-resolve.js";
import { generateRandomName } from "../lib/random-name.js";
import { provisionServer } from "../lib/provisioner.js";

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
  .action(
    async (opts: {
      name?: string;
      provider?: string;
      type?: string;
      region?: string;
    }) => {
      if (!hasSetup()) {
        outputError("Run 'hoist init' first.", undefined, { actor: "agent", action: "Run hoist init to set up.", command: "hoist init" });
        process.exit(1);
      }

      let resolved;
      try {
        resolved = getConfiguredProvider(opts.provider);
      } catch (err) {
        outputError(err instanceof Error ? err.message : "Provider error");
        process.exit(1);
      }
      const { label, providerConfig, provider } = resolved;

      const serverName = opts.name ?? generateRandomName();

      let region = opts.region;
      let availableRegions: RegionInfo[] = [];
      if (!region) {
        outputProgress("regions", `Fetching regions from ${label}`);
        availableRegions = await provider.listRegions(providerConfig.apiKey);

        if (availableRegions.length === 0) {
          outputError("No regions available from provider");
          process.exit(1);
        }
        region = availableRegions[0].id;
      }

      let serverType = opts.type;
      if (!serverType) {
        outputProgress("types", `Fetching server types from ${label}`);
        const types = await provider.listServerTypes(providerConfig.apiKey);

        if (types.length === 0) {
          outputError("No server types available from provider");
          process.exit(1);
        }
        serverType = types[0].id;
      }

      outputProgress("provision", `Provisioning ${serverType} in ${region} on ${label} as "${serverName}"`);

      const fallbackRegions = opts.region
        ? []
        : availableRegions.filter((r) => r.id !== region).map((r) => r.id);

      try {
        const { server: serverInfo, region: usedRegion } = await provisionServer({
          provider,
          apiKey: providerConfig.apiKey,
          name: serverName,
          type: serverType,
          region: region!,
          sshKeyPublic: readPublicKey(),
          fallbackRegions,
          onProgress: (msg) => {
            outputProgress("provision", msg);
          },
        });
        region = usedRegion;

        outputResult(
          { server: serverName, provider: label, ip: serverInfo.ip, type: serverType, region, status: "ready" },
          { actor: "agent", action: "Create hoist.json and deploy an app.", command: "hoist deploy" }
        );
      } catch (err) {
        outputError(
          "Server creation failed",
          err instanceof Error ? err.message : err
        );
        process.exit(1);
      }
    }
  );

serverCommand
  .command("regions")
  .description("List available regions for a provider")
  .option("--provider <provider>", "Provider label")
  .action(async (opts: { provider?: string }) => {
    if (!hasSetup()) {
      outputError("Run 'hoist init' first.", undefined, { actor: "agent", action: "Run hoist init to set up.", command: "hoist init" });
      process.exit(1);
    }
    const resolved = getConfiguredProvider(opts.provider);
    const regions = await resolved.provider.listRegions(resolved.providerConfig.apiKey);
    outputResult(regions);
  });

serverCommand
  .command("types")
  .description("List available server types and pricing for a provider")
  .option("--provider <provider>", "Provider label")
  .action(async (opts: { provider?: string }) => {
    if (!hasSetup()) {
      outputError("Run 'hoist init' first.", undefined, { actor: "agent", action: "Run hoist init to set up.", command: "hoist init" });
      process.exit(1);
    }
    const resolved = getConfiguredProvider(opts.provider);
    const types = await resolved.provider.listServerTypes(resolved.providerConfig.apiKey);
    outputResult(types);
  });

serverCommand
  .command("stats")
  .description("Show server resource usage (CPU, RAM, disk, bandwidth)")
  .argument("<name>", "Server name")
  .option("--provider <provider>", "Provider label")
  .action(async (name: string, opts: { provider?: string }) => {
    if (!hasSetup()) {
      outputError("Run 'hoist init' first.", undefined, { actor: "agent", action: "Run hoist init to set up.", command: "hoist init" });
      process.exit(1);
    }
    const config = getConfig();
    const labels = opts.provider ? [opts.provider] : Object.keys(config.providers);

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

    const sshOpts = { host: ip, port: 22, username: "root" };
    try {
      const result = await exec(sshOpts, [
        "echo CPU_CORES=$(nproc)",
        "echo CPU_USAGE=$(top -bn1 | grep 'Cpu(s)' | awk '{print 100 - $8}')",
        "free -b | awk '/Mem:/ {printf \"MEM_TOTAL=%s\\nMEM_USED=%s\\nMEM_AVAILABLE=%s\\n\", $2, $3, $7}'",
        "df -B1 / | awk 'NR==2 {printf \"DISK_TOTAL=%s\\nDISK_USED=%s\\nDISK_AVAILABLE=%s\\n\", $2, $3, $4}'",
        "cat /proc/uptime | awk '{printf \"UPTIME_SECONDS=%d\\n\", $1}'",
        "docker ps -q 2>/dev/null | wc -l | awk '{printf \"CONTAINERS_RUNNING=%s\\n\", $1}'",
      ].join(" && "));
      closeConnection(sshOpts);

      const vals: Record<string, string> = {};
      for (const line of result.stdout.split("\n")) {
        const [k, v] = line.split("=");
        if (k && v) vals[k.trim()] = v.trim();
      }

      const memTotal = Number(vals.MEM_TOTAL) || 0;
      const memUsed = Number(vals.MEM_USED) || 0;
      const diskTotal = Number(vals.DISK_TOTAL) || 0;
      const diskUsed = Number(vals.DISK_USED) || 0;
      const cpuUsage = parseFloat(vals.CPU_USAGE) || 0;
      const memPercent = memTotal > 0 ? (memUsed / memTotal) * 100 : 0;
      const diskPercent = diskTotal > 0 ? (diskUsed / diskTotal) * 100 : 0;

      const gb = (bytes: number) => (bytes / (1024 * 1024 * 1024)).toFixed(1);
      const uptimeHours = Math.floor((Number(vals.UPTIME_SECONDS) || 0) / 3600);

      const stats = {
        server: name,
        cpu: {
          cores: Number(vals.CPU_CORES) || 0,
          usagePercent: Math.round(cpuUsage * 10) / 10,
        },
        memory: {
          totalGb: gb(memTotal),
          usedGb: gb(memUsed),
          usagePercent: Math.round(memPercent * 10) / 10,
        },
        disk: {
          totalGb: gb(diskTotal),
          usedGb: gb(diskUsed),
          usagePercent: Math.round(diskPercent * 10) / 10,
        },
        containers: Number(vals.CONTAINERS_RUNNING) || 0,
        uptimeHours,
      };

      const warnings: string[] = [];
      if (cpuUsage > 80) warnings.push(`CPU at ${stats.cpu.usagePercent}% — consider upgrading`);
      if (memPercent > 80) warnings.push(`Memory at ${stats.memory.usagePercent}% — consider upgrading`);
      if (diskPercent > 80) warnings.push(`Disk at ${stats.disk.usagePercent}% — consider cleanup or upgrade`);

      outputResult(
        { ...stats, ...(warnings.length > 0 ? { warnings } : {}) },
        warnings.length > 0
          ? { actor: "user", action: `Server resources are running high. ${warnings[0]}.` }
          : undefined
      );
    } catch (err) {
      outputError("Failed to get server stats", err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

serverCommand
  .command("import")
  .description("Import an existing server by IP address")
  .option("--name <name>", "Server name (random if omitted)")
  .option("--ip <ip>", "Server IP address (required)")
  .option("--user <user>", "SSH user for initial connection", "root")
  .action(
    async (opts: {
      name?: string;
      ip?: string;
      user: string;
    }) => {
      if (!hasSetup()) {
        outputError("Run 'hoist init' first.", undefined, { actor: "agent", action: "Run hoist init to set up.", command: "hoist init" });
        process.exit(1);
      }

      const serverName = opts.name ?? generateRandomName();

      if (!opts.ip) {
        outputError("--ip is required");
        process.exit(1);
      }
      const ip = opts.ip;

      const sshOpts = {
        host: ip,
        port: 22,
        username: opts.user,
      };

      outputProgress("ssh", "Testing SSH connection");
      try {
        await exec(sshOpts, "echo ok");
      } catch (err) {
        outputError(
          "Cannot connect to server",
          err instanceof Error ? err.message : err
        );
        process.exit(1);
      }

      outputProgress("keys", "Uploading SSH public key");
      const publicKey = readPublicKey().replace(/'/g, "'\\''");
      try {
        await execOrFail(
          sshOpts,
          `mkdir -p ~/.ssh && echo '${publicKey}' >> ~/.ssh/authorized_keys && chmod 700 ~/.ssh && chmod 600 ~/.ssh/authorized_keys`
        );
      } catch (err) {
        outputError(
          "Failed to upload SSH key",
          err instanceof Error ? err.message : err
        );
        closeConnection(sshOpts);
        process.exit(1);
      }

      outputProgress("setup", "Setting up server (Docker, firewall, Traefik)");
      closeConnection(sshOpts);
      const hoistSshOpts = {
        host: ip,
        port: 22,
        username: "root",
      };

      try {
        await setupServer(hoistSshOpts, (msg) => {
          outputProgress("setup", msg);
        });
      } catch (err) {
        outputError(
          "Server setup warning",
          err instanceof Error ? err.message : err
        );
      }

      try {
        await checkHealth(hoistSshOpts);
      } catch {
        // Health check failure is non-fatal for import
      }

      closeConnection(hoistSshOpts);

      const config = getConfig();
      if (!config.importedServers) config.importedServers = {};
      config.importedServers[serverName] = { ip, user: "root" };
      updateConfig(config);

      outputResult(
        { server: serverName, provider: "imported", ip, status: "ready" },
        { actor: "agent", action: "Create hoist.json and deploy an app.", command: "hoist deploy" }
      );
    }
  );

serverCommand
  .command("list")
  .description("List all servers")
  .option("--provider <provider>", "Provider label (default: all)")
  .action(async (opts: { provider?: string }) => {
    if (!hasSetup()) {
      outputError("Run 'hoist init' first.", undefined, { actor: "agent", action: "Run hoist init to set up.", command: "hoist init" });
      process.exit(1);
    }
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
      } catch {
        // Skip providers that fail to list
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

    outputResult(allServers);
  });

serverCommand
  .command("status")
  .description("Server details and health")
  .argument("<name>", "Server name")
  .option("--provider <provider>", "Provider label")
  .action(
    async (
      name: string,
      opts: { provider?: string }
    ) => {
      if (!hasSetup()) {
        outputError("Run 'hoist init' first.", undefined, { actor: "agent", action: "Run hoist init to set up.", command: "hoist init" });
        process.exit(1);
      }
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

      outputResult({
        ...found,
        health: health
          ? { healthy: health.healthy, checks: health.details }
          : null,
      });
    }
  );

serverCommand
  .command("destroy")
  .description("Delete a server")
  .argument("<name>", "Server name")
  .option("--provider <provider>", "Provider label")
  .option("--confirm", "Confirm destructive action")
  .action(
    async (
      name: string,
      opts: { provider?: string; confirm?: boolean }
    ) => {
      if (!hasSetup()) {
        outputError("Run 'hoist init' first.", undefined, { actor: "agent", action: "Run hoist init to set up.", command: "hoist init" });
        process.exit(1);
      }

      if (!opts.confirm) {
        outputError(
          `Destructive action: this will permanently destroy server '${name}'. Re-run with --confirm to proceed.`,
          undefined,
          { actor: "agent", action: "Re-run with --confirm if the user approves.", command: `hoist server destroy ${name} --confirm` }
        );
        process.exit(1);
      }

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
        delete config.importedServers[name];
        updateConfig(config);
        outputResult({ status: "removed", server: name });
        return;
      }

      if (!found) {
        outputError(`Server "${name}" not found.`);
        process.exit(1);
      }

      const providerConfig = config.providers[found.provider];
      const provider = getProvider(providerConfig.type);

      outputProgress("destroy", `Destroying ${name}`);

      try {
        await provider.deleteServer(providerConfig.apiKey, found.id);
        outputResult({ status: "destroyed", server: name });
      } catch (err) {
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
      outputError("Run 'hoist init' first.", undefined, { actor: "agent", action: "Run hoist init to set up.", command: "hoist init" });
      process.exit(1);
    }
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
