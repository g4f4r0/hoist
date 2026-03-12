import fs from "node:fs";
import path from "node:path";

import { Command } from "commander";

import { listDatabases, deleteDatabase, getDatabaseInfo, controlDatabase, setDatabasePublic, formatSshTunnel } from "../lib/database.js";
import { listTemplates, getTemplate } from "../lib/templates/index.js";
import { resolveServer, resolveServers } from "../lib/server-resolve.js";
import { loadProjectConfig, getDefaultServer } from "../lib/project-config.js";
import { closeConnection, execOrFail, type SSHConnectionOptions } from "../lib/ssh.js";
import { outputResult, outputError, outputProgress } from "../lib/output.js";

export const templateCommand = new Command("template").description(
  "Manage templates and template-based services"
);

templateCommand
  .command("list")
  .description("List all available templates")
  .action(async () => {
    outputResult(listTemplates());
  });

templateCommand
  .command("info")
  .description("Show template details")
  .argument("<name>", "Template name")
  .action(async (name: string) => {
    let template;
    try {
      template = getTemplate(name);
    } catch {
      outputError(`Template "${name}" not found`);
      process.exit(3);
    }

    outputResult(template);
  });

templateCommand
  .command("services")
  .description("List running services created from templates")
  .option("--server <server>", "Filter by server name")
  .action(async (opts: { server?: string }) => {
    let config;
    try {
      config = loadProjectConfig();
    } catch (err) {
      outputError(err instanceof Error ? err.message : "Failed to load project config");
      process.exit(1);
    }

    if (opts.server && !config.servers[opts.server]) {
      outputError(`Server "${opts.server}" not found in hoist.json`);
      process.exit(1);
    }

    const serverEntries = opts.server
      ? { [opts.server]: config.servers[opts.server] }
      : config.servers;

    let resolved;
    try {
      resolved = await resolveServers(serverEntries);
    } catch (err) {
      outputError(err instanceof Error ? err.message : "Failed to resolve servers");
      process.exit(1);
    }

    const allServices: Array<{ server: string; sshTunnel: string } & { service: string; type: string; version: string; status: string; connectionString: string; container: string; port: number }> = [];

    for (const [name, server] of Object.entries(resolved)) {
      const ssh: SSHConnectionOptions = {
        host: server.ip,
        port: 22,
        username: "root",
      };

      try {
        const services = await listDatabases(ssh);
        for (const svc of services) {
          const sshTunnel = svc.port ? formatSshTunnel(server.ip, svc.container, svc.port) : "";
          allServices.push({ server: name, sshTunnel, ...svc });
        }
      } catch {
        // Skip servers that fail
      } finally {
        closeConnection(ssh);
      }
    }

    outputResult(allServices);
  });

templateCommand
  .command("inspect")
  .description("Show details of a running template service")
  .argument("<name>", "Service name")
  .option("--server <server>", "Server name")
  .action(
    async (
      name: string,
      opts: { server?: string }
    ) => {
      let config;
      try {
        config = loadProjectConfig();
      } catch (err) {
        outputError(err instanceof Error ? err.message : "Failed to load project config");
        process.exit(1);
      }

      let serverName;
      try {
        serverName = getDefaultServer(config, opts.server);
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

      const ssh: SSHConnectionOptions = {
        host: server.ip,
        port: 22,
        username: "root",
      };

      try {
        const info = await getDatabaseInfo(ssh, name);
        const sshTunnel = info.port ? formatSshTunnel(server.ip, info.container, info.port) : "";

        outputResult({ ...info, sshTunnel });
      } catch (err) {
        outputError(
          `Failed to get info for "${name}"`,
          err instanceof Error ? err.message : err
        );
        process.exit(1);
      } finally {
        closeConnection(ssh);
      }
    }
  );

templateCommand
  .command("destroy")
  .description("Destroy a template service")
  .argument("<name>", "Service name")
  .option("--server <server>", "Server name")
  .option("--delete-volumes", "Also delete data volumes")
  .option("--confirm", "Confirm destructive action")
  .action(
    async (
      name: string,
      opts: { server?: string; deleteVolumes?: boolean; confirm?: boolean }
    ) => {
      if (!opts.confirm) {
        outputError(
          `Destructive action: this will permanently destroy service '${name}' and its container. Re-run with --confirm to proceed.`,
          undefined,
          { actor: "agent", action: "Re-run with --confirm if the user approves.", command: `hoist template destroy ${name} --confirm` }
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

      let serverName;
      try {
        serverName = getDefaultServer(config, opts.server);
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

      const ssh: SSHConnectionOptions = {
        host: server.ip,
        port: 22,
        username: "root",
      };

      outputProgress("destroy", `Destroying service "${name}"`);

      try {
        await deleteDatabase(ssh, name, opts.deleteVolumes);
        outputResult({ status: "destroyed", service: name, server: serverName });
      } catch (err) {
        outputError(
          `Failed to destroy "${name}"`,
          err instanceof Error ? err.message : err
        );
        process.exit(1);
      } finally {
        closeConnection(ssh);
      }
    }
  );

templateCommand
  .command("backup")
  .description("Dump a database service to a local file")
  .argument("<name>", "Service name")
  .option("--server <server>", "Server name")
  .option("--output <path>", "Output file path")
  .action(
    async (
      name: string,
      opts: { server?: string; output?: string }
    ) => {
      let config;
      try {
        config = loadProjectConfig();
      } catch (err) {
        outputError(err instanceof Error ? err.message : "Failed to load project config");
        process.exit(1);
      }

      let serverName;
      try {
        serverName = getDefaultServer(config, opts.server);
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

      const ssh: SSHConnectionOptions = {
        host: server.ip,
        port: 22,
        username: "root",
      };

      outputProgress("backup", `Backing up service "${name}"`);

      try {
        outputProgress("backup", "Detecting database type");
        const { stdout: typeOutput } = await execOrFail(
          ssh,
          `docker inspect --format '{{index .Config.Labels "hoist.template"}}' ${name}`
        );
        const dbType = typeOutput.trim();

        if (!dbType) {
          throw new Error(`Could not detect database type for service "${name}"`);
        }

        let dumpCommand: string;
        let fileExt: string;

        switch (dbType) {
          case "postgres":
            dumpCommand = `docker exec ${name} pg_dumpall -U hoist`;
            fileExt = ".sql";
            break;
          case "mysql":
          case "mariadb":
            dumpCommand = `docker exec ${name} mysqldump -u root -p$MYSQL_ROOT_PASSWORD --all-databases`;
            fileExt = ".sql";
            break;
          case "mongodb":
            dumpCommand = `docker exec ${name} mongodump --archive --gzip`;
            fileExt = ".gz";
            break;
          case "redis":
            dumpCommand = `docker exec ${name} redis-cli BGSAVE && sleep 2 && docker cp ${name}:/data/dump.rdb /dev/stdout`;
            fileExt = ".rdb";
            break;
          default:
            throw new Error(`Unsupported database type "${dbType}" for backup`);
        }

        const timestamp = new Date().toISOString().replace(/[:.]/g, "-").replace("T", "_").slice(0, -5);
        const outputPath = opts.output
          ? path.resolve(opts.output)
          : path.resolve(`./${name}-${timestamp}${fileExt}`);

        outputProgress("backup", `Running ${dbType} dump`);
        const { stdout } = await execOrFail(ssh, dumpCommand);

        fs.writeFileSync(outputPath, stdout, dbType === "mongodb" || dbType === "redis" ? "binary" : "utf-8");

        const stats = fs.statSync(outputPath);

        outputResult({
          service: name,
          type: dbType,
          server: serverName,
          file: outputPath,
          size: stats.size,
        });
      } catch (err) {
        outputError(
          `Failed to back up "${name}"`,
          err instanceof Error ? err.message : err
        );
        process.exit(1);
      } finally {
        closeConnection(ssh);
      }
    }
  );

for (const mode of ["public", "private"] as const) {
  templateCommand
    .command(mode)
    .description(`Make a template service ${mode}`)
    .argument("<name>", "Service name")
    .option("--server <server>", "Server name")
    .action(
      async (
        name: string,
        opts: { server?: string }
      ) => {
        let config;
        try {
          config = loadProjectConfig();
        } catch (err) {
          outputError(err instanceof Error ? err.message : "Failed to load project config");
          process.exit(1);
        }

        let serverName;
        try {
          serverName = getDefaultServer(config, opts.server);
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

        const ssh: SSHConnectionOptions = {
          host: server.ip,
          port: 22,
          username: "root",
        };

        const makePublic = mode === "public";

        try {
          const result = await setDatabasePublic(ssh, name, makePublic, (msg) => {
            outputProgress(mode, msg);
          });

          const output: Record<string, unknown> = {
            service: result.service,
            status: result.status,
            public: result.public,
            connectionString: result.connectionString,
            server: serverName,
          };

          if (result.publicConnectionString) {
            output.publicConnectionString = result.publicConnectionString;
          }

          outputResult(output);
        } catch (err) {
          outputError(
            `Failed to make "${name}" ${mode}`,
            err instanceof Error ? err.message : err
          );
          process.exit(1);
        } finally {
          closeConnection(ssh);
        }
      }
    );
}

for (const action of ["stop", "start", "restart"] as const) {
  templateCommand
    .command(action)
    .description(`${action.charAt(0).toUpperCase() + action.slice(1)} a template service`)
    .argument("<name>", "Service name")
    .option("--server <server>", "Server name")
    .action(
      async (
        name: string,
        opts: { server?: string }
      ) => {
        let config;
        try {
          config = loadProjectConfig();
        } catch (err) {
          outputError(err instanceof Error ? err.message : "Failed to load project config");
          process.exit(1);
        }

        let serverName;
        try {
          serverName = getDefaultServer(config, opts.server);
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

        const ssh: SSHConnectionOptions = {
          host: server.ip,
          port: 22,
          username: "root",
        };

        try {
          await controlDatabase(ssh, name, action);
          outputResult({ status: action === "stop" ? "stopped" : "running", service: name, server: serverName });
        } catch (err) {
          outputError(
            `Failed to ${action} "${name}"`,
            err instanceof Error ? err.message : err
          );
          process.exit(1);
        } finally {
          closeConnection(ssh);
        }
      }
    );
}
