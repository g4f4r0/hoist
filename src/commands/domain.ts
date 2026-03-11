import { Command } from "commander";
import * as p from "@clack/prompts";
import chalk from "chalk";
import { loadProjectConfig, isAppService } from "../lib/project-config.js";
import { resolveServer, resolveServers } from "../lib/server-resolve.js";
import { addRoute, deleteRoute, listRoutes } from "../lib/caddy.js";
import { closeConnection } from "../lib/ssh.js";
import { outputJson, outputError, outputSuccess } from "../lib/output.js";

export const domainCommand = new Command("domain").description(
  "Manage domains and routing"
);

domainCommand
  .command("add")
  .description("Add a domain route for a service")
  .argument("<domain>", "Domain name")
  .requiredOption("--service <name>", "Service name")
  .option("--json", "Output as JSON")
  .action(
    async (
      domain: string,
      opts: { service: string; json?: boolean }
    ) => {
      let config;
      try {
        config = loadProjectConfig();
      } catch (err) {
        outputError(err instanceof Error ? err.message : "Failed to load project config");
        process.exit(1);
      }

      const service = config.services[opts.service];
      if (!service) {
        outputError(`Service "${opts.service}" not found in hoist.json`);
        process.exit(1);
      }

      if (!isAppService(service)) {
        outputError(`Service "${opts.service}" is not an app service`);
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
        await addRoute(ssh, domain, `hoist-${opts.service}:${service.port}`);
      } catch (err) {
        outputError(err instanceof Error ? err.message : "Failed to add route");
        closeConnection(ssh);
        process.exit(1);
      }

      closeConnection(ssh);

      const result = {
        domain,
        service: opts.service,
        serverIp: server.ip,
        note: `Point DNS A record to ${server.ip}`,
      };

      if (opts.json) {
        outputJson(result);
      } else {
        outputSuccess(
          `Route added: ${chalk.bold(domain)} → ${chalk.bold(opts.service)}`
        );
        p.log.info(chalk.dim(`Point DNS A record to ${server.ip}`));
      }
    }
  );

domainCommand
  .command("list")
  .description("List all domain routes")
  .option("--json", "Output as JSON")
  .action(async (opts: { json?: boolean }) => {
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
        if (!opts.json) {
          p.log.warning(
            `Failed to list routes on ${serverName}: ${err instanceof Error ? err.message : err}`
          );
        }
      }
      closeConnection(ssh);
    }

    if (opts.json) {
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
  .option("--json", "Output as JSON")
  .option("--yes", "Skip confirmation")
  .action(
    async (
      domain: string,
      opts: { json?: boolean; yes?: boolean }
    ) => {
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

      if (!opts.yes && !opts.json) {
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

      if (opts.json) {
        outputJson({ status: "deleted", domain, server: targetServer });
      } else {
        outputSuccess(`Route for "${domain}" deleted from ${targetServer}`);
      }
    }
  );
