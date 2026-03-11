import { Command } from "commander";
import * as p from "@clack/prompts";
import chalk from "chalk";
import { loadProjectConfig, isAppService, getOnlyAppService } from "../lib/project-config.js";
import { resolveServer, resolveServers } from "../lib/server-resolve.js";
import { addRoute, deleteRoute, listRoutes } from "../lib/caddy.js";
import { closeConnection } from "../lib/ssh.js";
import { outputJson, outputError, outputSuccess, isJsonMode, isAutoConfirm } from "../lib/output.js";

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
      const json = isJsonMode();

      let config;
      try {
        config = loadProjectConfig();
      } catch (err) {
        outputError(err instanceof Error ? err.message : "Failed to load project config");
        process.exit(1);
      }

      // Auto-detect service if not specified
      let serviceName = opts.service;
      if (!serviceName) {
        const only = getOnlyAppService(config);
        if (only) {
          serviceName = only[0];
        } else {
          outputError("Multiple app services found. Use --service to specify one.");
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
        await addRoute(ssh, domain, `hoist-${serviceName}:${service.port}`);
      } catch (err) {
        outputError(err instanceof Error ? err.message : "Failed to add route");
        closeConnection(ssh);
        process.exit(1);
      }

      closeConnection(ssh);

      const result = {
        domain,
        service: serviceName,
        serverIp: server.ip,
        note: `Point DNS A record to ${server.ip}`,
      };

      if (json) {
        outputJson(result);
      } else {
        outputSuccess(
          `Route added: ${chalk.bold(domain)} → ${chalk.bold(serviceName)}`
        );
        p.log.info(chalk.dim(`Point DNS A record to ${server.ip}`));
      }
    }
  );

domainCommand
  .command("list")
  .description("List all domain routes")
  .action(async () => {
    const json = isJsonMode();

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
    const allRoutes: Array<{ domain: string; upstream: string; server: string }> = [];

    for (const [serverName, info] of Object.entries(resolved)) {
      if (seen.has(info.ip)) continue;
      seen.add(info.ip);

      const ssh = { host: info.ip, port: 22, username: "root" };
      try {
        const routes = await listRoutes(ssh);
        for (const route of routes) {
          allRoutes.push({ ...route, server: serverName });
        }
      } catch (err) {
        if (!json) {
          p.log.warning(
            `Failed to list routes on ${serverName}: ${err instanceof Error ? err.message : err}`
          );
        }
      }
      closeConnection(ssh);
    }

    if (json) {
      outputJson(allRoutes);
      return;
    }

    if (allRoutes.length === 0) {
      p.log.info("No domain routes configured.");
      return;
    }

    for (const route of allRoutes) {
      p.log.info(
        `${chalk.bold(route.domain)} → ${chalk.dim(route.upstream)} ${chalk.dim("on")} ${route.server}`
      );
    }
  });

domainCommand
  .command("delete")
  .description("Delete a domain route")
  .argument("<domain>", "Domain name")
  .action(
    async (
      domain: string,
      opts: { }
    ) => {
      const json = isJsonMode();
      const yes = isAutoConfirm();

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
      const seen = new Set<string>();

      for (const [serverName, info] of Object.entries(resolved)) {
        if (seen.has(info.ip)) continue;
        seen.add(info.ip);

        const ssh = { host: info.ip, port: 22, username: "root" };
        try {
          const routes = await listRoutes(ssh);
          if (routes.some((r) => r.domain === domain)) {
            targetServer = serverName;
            targetIp = info.ip;
          }
        } catch {}
        closeConnection(ssh);
      }

      if (!targetServer) {
        outputError(`No route found for "${domain}" on any server`);
        process.exit(1);
      }

      if (!yes && !json) {
        const confirmed = await p.confirm({
          message: `Delete route for "${domain}" from ${targetServer}?`,
        });
        if (p.isCancel(confirmed) || !confirmed) return;
      }

      const ssh = { host: targetIp, port: 22, username: "root" };
      try {
        await deleteRoute(ssh, domain);
      } catch (err) {
        outputError(err instanceof Error ? err.message : "Failed to delete route");
        closeConnection(ssh);
        process.exit(1);
      }

      closeConnection(ssh);

      if (json) {
        outputJson({ status: "deleted", domain, server: targetServer });
      } else {
        outputSuccess(`Route for "${domain}" deleted from ${targetServer}`);
      }
    }
  );
