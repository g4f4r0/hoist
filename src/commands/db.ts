import { Command } from "commander";
import * as p from "@clack/prompts";
import chalk from "chalk";

import { createDatabase, listDatabases, deleteDatabase, getDatabaseInfo, controlDatabase } from "../lib/database.js";
import { listTemplates } from "../lib/templates/index.js";
import { resolveServer, resolveServers } from "../lib/server-resolve.js";
import { loadProjectConfig } from "../lib/project-config.js";
import { closeConnection, type SSHConnectionOptions } from "../lib/ssh.js";
import { outputJson, outputError, outputSuccess } from "../lib/output.js";

export const dbCommand = new Command("db").description("Manage databases");

dbCommand
  .command("create")
  .description("Create a new database service")
  .option("--name <name>", "Database name")
  .option("--type <type>", "Database type")
  .option("--version <version>", "Database version")
  .option("--server <server>", "Target server name")
  .option("--json", "Output as JSON")
  .option("--yes", "Skip confirmations")
  .action(
    async (opts: {
      name?: string;
      type?: string;
      version?: string;
      server?: string;
      json?: boolean;
      yes?: boolean;
    }) => {
      const templates = listTemplates();

      let dbType = opts.type;
      if (!dbType) {
        if (opts.json) {
          outputError("--type is required with --json");
          process.exit(1);
        }
        const selected = await p.select({
          message: "Database type:",
          options: templates.map((t) => ({
            value: t.name,
            label: `${t.name} — ${t.description}`,
          })),
        });
        if (p.isCancel(selected)) return;
        dbType = selected;
      }

      let dbName = opts.name;
      if (!dbName) {
        if (opts.json) {
          outputError("--name is required with --json");
          process.exit(1);
        }
        const input = await p.text({
          message: "Database name:",
          placeholder: dbType,
          validate: (v) => (v.length === 0 ? "Name is required" : undefined),
        });
        if (p.isCancel(input)) return;
        dbName = input;
      }

      let serverName = opts.server;
      let config;
      try {
        config = loadProjectConfig();
      } catch (err) {
        outputError(err instanceof Error ? err.message : "Failed to load project config");
        process.exit(1);
      }

      if (!serverName) {
        if (opts.json) {
          outputError("--server is required with --json");
          process.exit(1);
        }
        const serverNames = Object.keys(config.servers);
        if (serverNames.length === 0) {
          outputError("No servers defined in hoist.json");
          process.exit(1);
        }
        const selected = await p.select({
          message: "Server:",
          options: serverNames.map((name) => ({
            value: name,
            label: `${name} (${config.servers[name].provider})`,
          })),
        });
        if (p.isCancel(selected)) return;
        serverName = selected;
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

      const spinner = p.spinner();
      if (!opts.json) spinner.start(`Creating ${dbType} database "${dbName}"...`);

      try {
        const result = await createDatabase({
          ssh,
          serviceName: dbName,
          templateName: dbType,
          version: opts.version,
          onLog: (msg) => {
            if (!opts.json) spinner.message(msg);
          },
        });

        if (!opts.json) spinner.stop(chalk.green(`Database "${dbName}" created.`));

        const output = {
          service: result.service,
          type: result.type,
          version: result.version,
          connectionString: result.connectionString,
          status: result.status,
          server: serverName,
        };

        if (opts.json) {
          outputJson(output);
        } else {
          p.log.info(`${chalk.bold("Connection string:")} ${result.connectionString}`);
          outputSuccess(`Database "${dbName}" is ready on ${serverName}`);
        }
      } catch (err) {
        if (!opts.json) spinner.stop(chalk.red("Failed."));
        outputError(
          "Database creation failed",
          err instanceof Error ? err.message : err
        );
        process.exit(1);
      } finally {
        closeConnection(ssh);
      }
    }
  );

dbCommand
  .command("list")
  .description("List all databases")
  .option("--server <server>", "Filter by server name")
  .option("--json", "Output as JSON")
  .action(async (opts: { server?: string; json?: boolean }) => {
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

    const allDatabases: Array<{ server: string } & { service: string; type: string; version: string; status: string; connectionString: string; container: string }> = [];

    for (const [name, server] of Object.entries(resolved)) {
      const ssh: SSHConnectionOptions = {
        host: server.ip,
        port: 22,
        username: "root",
      };

      try {
        const databases = await listDatabases(ssh);
        for (const db of databases) {
          allDatabases.push({ server: name, ...db });
        }
      } catch (err) {
        if (!opts.json) {
          p.log.warning(
            `Failed to list databases on ${name}: ${err instanceof Error ? err.message : err}`
          );
        }
      } finally {
        closeConnection(ssh);
      }
    }

    if (opts.json) {
      outputJson(allDatabases);
      return;
    }

    if (allDatabases.length === 0) {
      p.log.info("No databases found. Create one with: hoist db create");
      return;
    }

    for (const db of allDatabases) {
      const statusColor =
        db.status === "running"
          ? chalk.green(db.status)
          : chalk.yellow(db.status);
      p.log.info(
        `${chalk.bold(db.service)} ${chalk.dim(db.server)} ${db.type} ${statusColor}`
      );
    }
  });

dbCommand
  .command("info")
  .description("Show database details")
  .argument("<name>", "Database name")
  .requiredOption("--server <server>", "Server name")
  .option("--json", "Output as JSON")
  .action(
    async (
      name: string,
      opts: { server: string; json?: boolean }
    ) => {
      let config;
      try {
        config = loadProjectConfig();
      } catch (err) {
        outputError(err instanceof Error ? err.message : "Failed to load project config");
        process.exit(1);
      }

      const serverConfig = config.servers[opts.server];
      if (!serverConfig) {
        outputError(`Server "${opts.server}" not found in hoist.json`);
        process.exit(1);
      }

      let server;
      try {
        server = await resolveServer(opts.server, serverConfig);
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

        if (opts.json) {
          outputJson(info);
          return;
        }

        p.log.info(`${chalk.bold("Name:")}       ${info.service}`);
        p.log.info(`${chalk.bold("Type:")}       ${info.type}`);
        p.log.info(`${chalk.bold("Version:")}    ${info.version}`);
        p.log.info(`${chalk.bold("Status:")}     ${info.status}`);
        p.log.info(`${chalk.bold("Connection:")} ${info.connectionString}`);
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

dbCommand
  .command("destroy")
  .description("Destroy a database")
  .argument("<name>", "Database name")
  .requiredOption("--server <server>", "Server name")
  .option("--yes", "Skip confirmation")
  .option("--json", "Output as JSON")
  .option("--delete-volumes", "Also delete data volumes")
  .action(
    async (
      name: string,
      opts: { server: string; yes?: boolean; json?: boolean; deleteVolumes?: boolean }
    ) => {
      if (!opts.yes && !opts.json) {
        const confirmed = await p.confirm({
          message: `Destroy database "${name}"? This cannot be undone.`,
        });
        if (p.isCancel(confirmed) || !confirmed) return;
      }

      let config;
      try {
        config = loadProjectConfig();
      } catch (err) {
        outputError(err instanceof Error ? err.message : "Failed to load project config");
        process.exit(1);
      }

      const serverConfig = config.servers[opts.server];
      if (!serverConfig) {
        outputError(`Server "${opts.server}" not found in hoist.json`);
        process.exit(1);
      }

      let server;
      try {
        server = await resolveServer(opts.server, serverConfig);
      } catch (err) {
        outputError(err instanceof Error ? err.message : "Failed to resolve server");
        process.exit(1);
      }

      const ssh: SSHConnectionOptions = {
        host: server.ip,
        port: 22,
        username: "root",
      };

      const spinner = p.spinner();
      if (!opts.json) spinner.start(`Destroying database "${name}"...`);

      try {
        await deleteDatabase(ssh, name, opts.deleteVolumes);
        if (!opts.json) spinner.stop(`Database "${name}" destroyed.`);
        if (opts.json) {
          outputJson({ status: "destroyed", database: name, server: opts.server });
        } else {
          outputSuccess(`Database "${name}" destroyed.`);
        }
      } catch (err) {
        if (!opts.json) spinner.stop(chalk.red("Failed."));
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

for (const action of ["stop", "start", "restart"] as const) {
  dbCommand
    .command(action)
    .description(`${action.charAt(0).toUpperCase() + action.slice(1)} a database`)
    .argument("<name>", "Database name")
    .requiredOption("--server <server>", "Server name")
    .option("--json", "Output as JSON")
    .action(
      async (
        name: string,
        opts: { server: string; json?: boolean }
      ) => {
        let config;
        try {
          config = loadProjectConfig();
        } catch (err) {
          outputError(err instanceof Error ? err.message : "Failed to load project config");
          process.exit(1);
        }

        const serverConfig = config.servers[opts.server];
        if (!serverConfig) {
          outputError(`Server "${opts.server}" not found in hoist.json`);
          process.exit(1);
        }

        let server;
        try {
          server = await resolveServer(opts.server, serverConfig);
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
          if (opts.json) {
            outputJson({ status: action === "stop" ? "stopped" : "running", database: name, server: opts.server });
          } else {
            outputSuccess(`Database "${name}" ${action === "restart" ? "restarted" : action === "stop" ? "stopped" : "started"}.`);
          }
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
