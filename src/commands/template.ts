import fs from "node:fs";
import path from "node:path";

import { Command } from "commander";
import * as p from "@clack/prompts";
import chalk from "chalk";

import { createDatabase, listDatabases, deleteDatabase, getDatabaseInfo, controlDatabase } from "../lib/database.js";
import { listTemplates, getTemplate } from "../lib/templates/index.js";
import { resolveServer, resolveServers } from "../lib/server-resolve.js";
import { loadProjectConfig, getDefaultServer } from "../lib/project-config.js";
import { closeConnection, execOrFail, type SSHConnectionOptions } from "../lib/ssh.js";
import { outputJson, outputError, outputSuccess, isJsonMode, isAutoConfirm } from "../lib/output.js";

export const templateCommand = new Command("template").description(
  "Manage templates and template-based services"
);

templateCommand
  .command("list")
  .description("List all available templates")
  .action(async () => {
    const json = isJsonMode();
    const templates = listTemplates();

    if (json) {
      outputJson(templates);
      return;
    }

    if (templates.length === 0) {
      p.log.info("No templates available.");
      return;
    }

    for (const t of templates) {
      p.log.info(`${chalk.bold(t.name)} — ${t.description}`);
    }
  });

templateCommand
  .command("info")
  .description("Show template details")
  .argument("<name>", "Template name")
  .action(async (name: string, opts: { }) => {
    const json = isJsonMode();
    let template;
    try {
      template = getTemplate(name);
    } catch {
      outputError(`Template "${name}" not found`);
      process.exit(3);
    }

    if (json) {
      outputJson(template);
      return;
    }

    p.log.info(`${chalk.bold("Name:")}        ${template.name}`);
    p.log.info(`${chalk.bold("Description:")} ${template.description}`);
    p.log.info(`${chalk.bold("Image:")}       ${template.image}`);
    p.log.info(`${chalk.bold("Version:")}     ${template.defaultVersion}`);
    p.log.info(`${chalk.bold("Port:")}        ${template.port}`);

    const envKeys = Object.keys(template.env);
    if (envKeys.length > 0) {
      p.log.info(`${chalk.bold("Env vars:")}    ${envKeys.join(", ")}`);
    }

    const volumePaths = Object.keys(template.volumes);
    if (volumePaths.length > 0) {
      p.log.info(`${chalk.bold("Volumes:")}     ${volumePaths.join(", ")}`);
    }
  });

templateCommand
  .command("create")
  .description("Create a service from a template")
  .option("--name <name>", "Service name (defaults to template type)")
  .option("--type <type>", "Template type")
  .option("--version <version>", "Version override")
  .option("--server <server>", "Target server name (auto-detected if only one)")
  .action(
    async (opts: {
      name?: string;
      type?: string;
      version?: string;
      server?: string;
    }) => {
      const json = isJsonMode();
      const templates = listTemplates();

      let templateType = opts.type;
      if (!templateType) {
        if (json) {
          outputError("--type is required");
          process.exit(1);
        }
        const selected = await p.select({
          message: "Template:",
          options: templates.map((t) => ({
            value: t.name,
            label: `${t.name} — ${t.description}`,
          })),
        });
        if (p.isCancel(selected)) return;
        templateType = selected;
      }

      // Default name to template type
      let serviceName = opts.name ?? templateType;
      if (!serviceName) {
        if (json) {
          outputError("--name or --type is required");
          process.exit(1);
        }
        const input = await p.text({
          message: "Service name:",
          placeholder: templateType,
          validate: (v) => (v.length === 0 ? "Name is required" : undefined),
        });
        if (p.isCancel(input)) return;
        serviceName = input;
      }

      let config;
      try {
        config = loadProjectConfig();
      } catch (err) {
        outputError(err instanceof Error ? err.message : "Failed to load project config");
        process.exit(1);
      }

      // Auto-detect server if only one exists
      let serverName = opts.server;
      if (!serverName) {
        try {
          serverName = getDefaultServer(config);
        } catch {
          // Multiple servers — need user input
          if (json) {
            outputError("Multiple servers. Use --server to specify one.");
            process.exit(1);
          }
          const serverNames = Object.keys(config.servers);
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
      if (!json) spinner.start(`Creating ${templateType} service "${serviceName}"...`);

      try {
        const result = await createDatabase({
          ssh,
          serviceName,
          templateName: templateType,
          version: opts.version,
          onLog: (msg) => {
            if (!json) spinner.message(msg);
          },
        });

        if (!json) spinner.stop(chalk.green(`Service "${serviceName}" created.`));

        const output = {
          service: result.service,
          type: result.type,
          version: result.version,
          connectionString: result.connectionString,
          status: result.status,
          server: serverName,
        };

        if (json) {
          outputJson(output);
        } else {
          if (result.connectionString) {
            p.log.info(`${chalk.bold("Connection string:")} ${result.connectionString}`);
          }
          outputSuccess(`Service "${serviceName}" is ready on ${serverName}`);
        }
      } catch (err) {
        if (!json) spinner.stop(chalk.red("Failed."));
        outputError(
          "Service creation failed",
          err instanceof Error ? err.message : err
        );
        process.exit(1);
      } finally {
        closeConnection(ssh);
      }
    }
  );

templateCommand
  .command("services")
  .description("List running services created from templates")
  .option("--server <server>", "Filter by server name")
  .action(async (opts: { server?: string }) => {
    const json = isJsonMode();

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

    const allServices: Array<{ server: string } & { service: string; type: string; version: string; status: string; connectionString: string; container: string }> = [];

    for (const [name, server] of Object.entries(resolved)) {
      const ssh: SSHConnectionOptions = {
        host: server.ip,
        port: 22,
        username: "root",
      };

      try {
        const services = await listDatabases(ssh);
        for (const svc of services) {
          allServices.push({ server: name, ...svc });
        }
      } catch (err) {
        if (!json) {
          p.log.warning(
            `Failed to list services on ${name}: ${err instanceof Error ? err.message : err}`
          );
        }
      } finally {
        closeConnection(ssh);
      }
    }

    if (json) {
      outputJson(allServices);
      return;
    }

    if (allServices.length === 0) {
      p.log.info("No template services found. Create one with: hoist template create");
      return;
    }

    for (const svc of allServices) {
      const statusColor =
        svc.status === "running"
          ? chalk.green(svc.status)
          : chalk.yellow(svc.status);
      p.log.info(
        `${chalk.bold(svc.service)} ${chalk.dim(svc.server)} ${svc.type} ${statusColor}`
      );
    }
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
      const json = isJsonMode();

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

        if (json) {
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

templateCommand
  .command("destroy")
  .description("Destroy a template service")
  .argument("<name>", "Service name")
  .option("--server <server>", "Server name")
  .option("--delete-volumes", "Also delete data volumes")
  .action(
    async (
      name: string,
      opts: { server?: string; deleteVolumes?: boolean }
    ) => {
      const json = isJsonMode();
      const yes = isAutoConfirm();

      if (!yes && !json) {
        const confirmed = await p.confirm({
          message: `Destroy service "${name}"? This cannot be undone.`,
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

      const spinner = p.spinner();
      if (!json) spinner.start(`Destroying service "${name}"...`);

      try {
        await deleteDatabase(ssh, name, opts.deleteVolumes);
        if (!json) spinner.stop(`Service "${name}" destroyed.`);
        if (json) {
          outputJson({ status: "destroyed", service: name, server: serverName });
        } else {
          outputSuccess(`Service "${name}" destroyed.`);
        }
      } catch (err) {
        if (!json) spinner.stop(chalk.red("Failed."));
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
      const json = isJsonMode();

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

      const spinner = p.spinner();
      if (!json) spinner.start(`Backing up service "${name}"...`);

      try {
        if (!json) spinner.message("Detecting database type...");
        const { stdout: typeOutput } = await execOrFail(
          ssh,
          `docker inspect --format '{{index .Config.Labels "hoist.type"}}' hoist-${name}`
        );
        const dbType = typeOutput.trim();

        if (!dbType) {
          throw new Error(`Could not detect database type for service "${name}"`);
        }

        let dumpCommand: string;
        let fileExt: string;

        switch (dbType) {
          case "postgres":
            dumpCommand = `docker exec hoist-${name} pg_dumpall -U hoist`;
            fileExt = ".sql";
            break;
          case "mysql":
          case "mariadb":
            dumpCommand = `docker exec hoist-${name} mysqldump -u root -p$MYSQL_ROOT_PASSWORD --all-databases`;
            fileExt = ".sql";
            break;
          case "mongodb":
            dumpCommand = `docker exec hoist-${name} mongodump --archive --gzip`;
            fileExt = ".gz";
            break;
          case "redis":
            dumpCommand = `docker exec hoist-${name} redis-cli BGSAVE && sleep 2 && docker cp hoist-${name}:/data/dump.rdb /dev/stdout`;
            fileExt = ".rdb";
            break;
          default:
            throw new Error(`Unsupported database type "${dbType}" for backup`);
        }

        const timestamp = new Date().toISOString().replace(/[:.]/g, "-").replace("T", "_").slice(0, -5);
        const outputPath = opts.output
          ? path.resolve(opts.output)
          : path.resolve(`./${name}-${timestamp}${fileExt}`);

        if (!json) spinner.message(`Running ${dbType} dump...`);
        const { stdout } = await execOrFail(ssh, dumpCommand);

        fs.writeFileSync(outputPath, stdout, dbType === "mongodb" || dbType === "redis" ? "binary" : "utf-8");

        const stats = fs.statSync(outputPath);
        const sizeKb = (stats.size / 1024).toFixed(1);

        if (!json) spinner.stop(chalk.green(`Backup complete.`));

        const output = {
          service: name,
          type: dbType,
          server: serverName,
          file: outputPath,
          size: stats.size,
        };

        if (json) {
          outputJson(output);
        } else {
          p.log.info(`${chalk.bold("File:")} ${outputPath}`);
          p.log.info(`${chalk.bold("Size:")} ${sizeKb} KB`);
          outputSuccess(`Service "${name}" backed up successfully.`);
        }
      } catch (err) {
        if (!json) spinner.stop(chalk.red("Failed."));
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
        const json = isJsonMode();

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
          if (json) {
            outputJson({ status: action === "stop" ? "stopped" : "running", service: name, server: serverName });
          } else {
            outputSuccess(`Service "${name}" ${action === "restart" ? "restarted" : action === "stop" ? "stopped" : "started"}.`);
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
