import { Command } from "commander";

import { loadProjectConfig, isAppService, getOnlyAppService } from "../lib/project-config.js";
import { resolveServer, resolveServers } from "../lib/server-resolve.js";
import { addRoute, deleteRoute, listRoutes, isAutoDomain, parseWwwPair } from "../lib/traefik.js";
import { closeConnection } from "../lib/ssh.js";
import { outputResult, outputError } from "../lib/output.js";

export const domainCommand = new Command("domain").description(
  "Manage domains and routing"
);

domainCommand
  .command("add")
  .description("Add a domain route for a service")
  .argument("<domain>", "Domain name")
  .option("--service <name>", "Service name (auto-detected if only one app service)")
  .action(
    async (
      domain: string,
      opts: { service?: string }
    ) => {
      let config;
      try {
        config = loadProjectConfig();
      } catch (err) {
        outputError(err instanceof Error ? err.message : "Failed to load project config");
        process.exit(1);
      }

      let serviceName = opts.service;
      if (!serviceName) {
        const only = getOnlyAppService(config);
        if (only) {
          serviceName = only[0];
        } else {
          outputError("Multiple app services found. Use --service to specify one.", undefined, { actor: "agent", action: "Re-run with --service to pick one.", command: "hoist domain add <domain> --service <name>" });
          process.exit(1);
        }
      }

      const service = config.services[serviceName];
      if (!service) {
        outputError(`Service "${serviceName}" not found in hoist.json`);
        process.exit(1);
      }

      if (!isAppService(service)) {
        outputError(`Service "${serviceName}" is not an app service`);
        process.exit(1);
      }

      let server;
      try {
        server = await resolveServer(service.server, { provider: config.servers[service.server].provider });
      } catch (err) {
        outputError(err instanceof Error ? err.message : "Failed to resolve server");
        process.exit(1);
      }

      const ssh = { host: server.ip, port: 22, username: "root" };

      try {
        await addRoute(ssh, serviceName, domain, `${serviceName}:${service.port}`);
      } catch (err) {
        outputError(err instanceof Error ? err.message : "Failed to add route");
        closeConnection(ssh);
        process.exit(1);
      }

      closeConnection(ssh);

      if (isAutoDomain(domain)) {
        outputResult(
          { domain, service: serviceName, serverIp: server.ip },
          { actor: "user", action: `Point DNS A record for ${domain} to ${server.ip}. SSL will auto-provision via Let's Encrypt.` }
        );
      } else {
        const { canonical, alternate } = parseWwwPair(domain);
        outputResult(
          { domain: canonical, alternate, service: serviceName, serverIp: server.ip },
          { actor: "user", action: `Point DNS A records for both ${canonical} and ${alternate} to ${server.ip}. The alternate will redirect to ${canonical}. SSL will auto-provision via Let's Encrypt.` }
        );
      }
    }
  );

domainCommand
  .command("list")
  .description("List all domain routes")
  .action(async () => {
    let config;
    try {
      config = loadProjectConfig();
    } catch (err) {
      outputError(err instanceof Error ? err.message : "Failed to load project config");
      process.exit(1);
    }

    let resolved;
    try {
      resolved = await resolveServers(config.servers);
    } catch (err) {
      outputError(err instanceof Error ? err.message : "Failed to resolve servers");
      process.exit(1);
    }

    const seen = new Set<string>();
    const allRoutes: Array<{ appName: string; domain: string; upstream: string; server: string }> = [];

    for (const [serverName, info] of Object.entries(resolved)) {
      if (seen.has(info.ip)) continue;
      seen.add(info.ip);

      const ssh = { host: info.ip, port: 22, username: "root" };
      try {
        const routes = await listRoutes(ssh);
        for (const route of routes) {
          allRoutes.push({ ...route, server: serverName });
        }
      } catch {
        // Skip servers that fail
      }
      closeConnection(ssh);
    }

    outputResult(allRoutes);
  });

domainCommand
  .command("delete")
  .description("Delete a domain route")
  .argument("<domain>", "Domain name")
  .option("--confirm", "Confirm destructive action")
  .action(
    async (
      domain: string,
      opts: { confirm?: boolean }
    ) => {
      if (!opts.confirm) {
        outputError(
          `Destructive action: this will delete the route for domain '${domain}'. Re-run with --confirm to proceed.`,
          undefined,
          { actor: "agent", action: "Re-run with --confirm if the user approves.", command: `hoist domain delete ${domain} --confirm` }
        );
        process.exit(1);
      }

      let config;
      try {
        config = loadProjectConfig();
      } catch (err) {
        outputError(err instanceof Error ? err.message : "Failed to load project config");
        process.exit(1);
      }

      let resolved;
      try {
        resolved = await resolveServers(config.servers);
      } catch (err) {
        outputError(err instanceof Error ? err.message : "Failed to resolve servers");
        process.exit(1);
      }

      let targetServer: string | null = null;
      let targetIp = "";
      let targetAppName = "";
      const seen = new Set<string>();

      for (const [serverName, info] of Object.entries(resolved)) {
        if (seen.has(info.ip)) continue;
        seen.add(info.ip);

        const ssh = { host: info.ip, port: 22, username: "root" };
        try {
          const routes = await listRoutes(ssh);
          const match = routes.find((r) => r.domain === domain);
          if (match) {
            targetServer = serverName;
            targetIp = info.ip;
            targetAppName = match.appName;
          }
        } catch {
          // Skip servers that fail
        }
        closeConnection(ssh);
      }

      if (!targetServer || !targetAppName) {
        outputError(`No route found for "${domain}" on any server`);
        process.exit(1);
      }

      const ssh = { host: targetIp, port: 22, username: "root" };
      try {
        await deleteRoute(ssh, targetAppName);
      } catch (err) {
        outputError(err instanceof Error ? err.message : "Failed to delete route");
        closeConnection(ssh);
        process.exit(1);
      }

      closeConnection(ssh);

      outputResult({ status: "deleted", domain, server: targetServer });
    }
  );
