import { Command } from "commander";

import { resolveServer, resolveServers } from "../lib/server-resolve.js";
import { loadProjectConfig, getServerForService } from "../lib/project-config.js";
import { exec, closeConnection, type SSHConnectionOptions } from "../lib/ssh.js";
import { outputResult, outputError } from "../lib/output.js";

const INFRA_CONTAINERS = ["traefik"];

async function resolveInfraServer(
  serverName?: string
): Promise<{ ssh: SSHConnectionOptions; resolvedName: string }> {
  const config = loadProjectConfig();
  const resolved = await resolveServers(config.servers);

  if (serverName) {
    const info = resolved[serverName];
    if (!info) {
      throw new Error(`Server "${serverName}" not found`);
    }
    return {
      ssh: { host: info.ip, port: 22, username: "root" },
      resolvedName: serverName,
    };
  }

  const names = Object.keys(resolved);
  if (names.length === 0) {
    throw new Error("No servers found in hoist.json");
  }
  if (names.length > 1) {
    throw new Error(
      "Multiple servers found. Use --server to specify one."
    );
  }
  const name = names[0];
  return {
    ssh: { host: resolved[name].ip, port: 22, username: "root" },
    resolvedName: name,
  };
}

export const logsCommand = new Command("logs")
  .description("View container logs")
  .argument("<service>", "Service or infrastructure name (e.g. api, traefik)")
  .option("--server <server>", "Server name")
  .option("--lines <n>", "Number of lines", "100")
  .option("--follow", "Follow log output (raw lines to stdout)")
  .action(
    async (
      service: string,
      opts: { server?: string; lines: string; follow?: boolean }
    ) => {
      const isInfra = INFRA_CONTAINERS.includes(service);

      let ssh: SSHConnectionOptions;
      let serverName: string;
      let container: string;

      if (isInfra) {
        container = `hoist-${service}`;
        try {
          const result = await resolveInfraServer(opts.server);
          ssh = result.ssh;
          serverName = result.resolvedName;
        } catch (err) {
          outputError(err instanceof Error ? err.message : "Failed to resolve server");
          process.exit(1);
        }
      } else {
        container = service;
        let config;
        try {
          config = loadProjectConfig();
        } catch (err) {
          outputError(err instanceof Error ? err.message : "Failed to load project config");
          process.exit(1);
        }

        try {
          serverName = getServerForService(config, service, opts.server);
        } catch (err) {
          outputError(err instanceof Error ? err.message : "Failed to resolve server");
          process.exit(1);
        }

        const serverConfig = config.servers[serverName];
        if (!serverConfig) {
          outputError(`Server "${serverName}" not found in hoist.json`);
          process.exit(1);
        }

        let server;
        try {
          server = await resolveServer(serverName, serverConfig);
        } catch (err) {
          outputError(err instanceof Error ? err.message : "Failed to resolve server");
          process.exit(1);
        }

        ssh = { host: server.ip, port: 22, username: "root" };
      }

      const lines = parseInt(opts.lines, 10);
      if (isNaN(lines) || lines < 1) {
        outputError("--lines must be a positive integer");
        process.exit(1);
      }

      const cmd = opts.follow
        ? `docker logs ${container} --tail ${lines} -f 2>&1`
        : `docker logs ${container} --tail ${lines} 2>&1`;

      try {
        if (opts.follow) {
          const onSigint = () => {
            closeConnection(ssh);
            process.exit(0);
          };
          process.on("SIGINT", onSigint);

          await exec(ssh, cmd, (data) => {
            process.stdout.write(data);
          });
        } else {
          const result = await exec(ssh, cmd);

          outputResult({
            service,
            server: serverName,
            lines: result.stdout.split("\n"),
          });
        }
      } catch (err) {
        outputError(
          `Failed to get logs for "${service}"`,
          err instanceof Error ? err.message : err
        );
        process.exit(1);
      } finally {
        closeConnection(ssh);
      }
    }
  );
