import { Command } from "commander";
import * as p from "@clack/prompts";
import chalk from "chalk";

import { listEnv, recreateWithEnv, parseEnvArgs } from "../lib/container-env.js";
import { loadEnvFile } from "../lib/deploy.js";
import { resolveServer } from "../lib/server-resolve.js";
import { loadProjectConfig, getServerForService } from "../lib/project-config.js";
import { closeConnection, type SSHConnectionOptions } from "../lib/ssh.js";
import { outputJson, outputError, outputSuccess, isJsonMode } from "../lib/output.js";

export const envCommand = new Command("env").description("Manage service environment variables");

function loadConfigAndResolve(serviceName: string, specified?: string) {
  const config = loadProjectConfig();
  const serverName = getServerForService(config, serviceName, specified);
  const serverConfig = config.servers[serverName];
  if (!serverConfig) {
    throw new Error(`Server "${serverName}" not found in hoist.json`);
  }
  return { config, serverConfig, serverName };
}

envCommand
  .command("set")
  .description("Set environment variables on a service")
  .argument("<service>", "Service name")
  .argument("[vars...]", "KEY=VALUE pairs")
  .option("--server <server>", "Server name")
  .option("--json", "Output as JSON")
  .action(
    async (
      service: string,
      vars: string[],
      opts: { server?: string; json?: boolean }
    ) => {
      const json = opts.json || isJsonMode();
      let ssh: SSHConnectionOptions | undefined;

      try {
        const { serverConfig, serverName } = loadConfigAndResolve(service, opts.server);
        const server = await resolveServer(serverName, serverConfig);
        ssh = { host: server.ip, port: 22, username: "root" };

        const newEnv = parseEnvArgs(vars);
        const current = await listEnv(ssh, service);
        const merged = { ...current, ...newEnv };

        const spinner = p.spinner();
        if (!json) spinner.start(`Updating environment for "${service}"...`);

        await recreateWithEnv(ssh, service, merged);

        if (!json) spinner.stop(chalk.green(`Environment updated for "${service}".`));

        const updated = Object.keys(newEnv);
        if (json) {
          outputJson({ service, server: serverName, updated });
        } else {
          outputSuccess(`Set ${updated.join(", ")} on ${service}`);
        }
      } catch (err) {
        outputError(
          "Failed to set environment variables",
          err instanceof Error ? err.message : err
        );
        process.exit(1);
      } finally {
        if (ssh) closeConnection(ssh);
      }
    }
  );

envCommand
  .command("get")
  .description("Get the value of an environment variable")
  .argument("<service>", "Service name")
  .argument("<key>", "Environment variable key")
  .option("--server <server>", "Server name")
  .option("--json", "Output as JSON")
  .action(
    async (
      service: string,
      key: string,
      opts: { server?: string; json?: boolean }
    ) => {
      const json = opts.json || isJsonMode();
      let ssh: SSHConnectionOptions | undefined;

      try {
        const { serverConfig, serverName } = loadConfigAndResolve(service, opts.server);
        const server = await resolveServer(serverName, serverConfig);
        ssh = { host: server.ip, port: 22, username: "root" };

        const env = await listEnv(ssh, service);
        const value = env[key];

        if (value === undefined) {
          outputError(`Variable "${key}" not found on service "${service}"`);
          process.exit(3);
        }

        if (json) {
          outputJson({ service, key, value });
        } else {
          p.log.info(`${chalk.bold(key)}=${value}`);
        }
      } catch (err) {
        outputError(
          "Failed to get environment variable",
          err instanceof Error ? err.message : err
        );
        process.exit(1);
      } finally {
        if (ssh) closeConnection(ssh);
      }
    }
  );

envCommand
  .command("list")
  .description("List environment variables for a service")
  .argument("<service>", "Service name")
  .option("--server <server>", "Server name")
  .option("--json", "Output as JSON")
  .option("--show-values", "Show actual values instead of masking")
  .action(
    async (
      service: string,
      opts: { server?: string; json?: boolean; showValues?: boolean }
    ) => {
      const json = opts.json || isJsonMode();
      let ssh: SSHConnectionOptions | undefined;

      try {
        const { serverConfig, serverName } = loadConfigAndResolve(service, opts.server);
        const server = await resolveServer(serverName, serverConfig);
        ssh = { host: server.ip, port: 22, username: "root" };

        const env = await listEnv(ssh, service);

        if (json) {
          // JSON mode: always return real values (agents need them)
          outputJson({ service, env });
        } else {
          if (Object.keys(env).length === 0) {
            p.log.info(`No environment variables set for "${service}".`);
            return;
          }
          for (const [key, value] of Object.entries(env)) {
            p.log.info(`${chalk.bold(key)}=${opts.showValues ? value : "****"}`);
          }
        }
      } catch (err) {
        outputError(
          "Failed to list environment variables",
          err instanceof Error ? err.message : err
        );
        process.exit(1);
      } finally {
        if (ssh) closeConnection(ssh);
      }
    }
  );

envCommand
  .command("delete")
  .description("Delete an environment variable from a service")
  .argument("<service>", "Service name")
  .argument("<key>", "Environment variable key to delete")
  .option("--server <server>", "Server name")
  .option("--json", "Output as JSON")
  .action(
    async (
      service: string,
      key: string,
      opts: { server?: string; json?: boolean }
    ) => {
      const json = opts.json || isJsonMode();
      let ssh: SSHConnectionOptions | undefined;

      try {
        const { serverConfig, serverName } = loadConfigAndResolve(service, opts.server);
        const server = await resolveServer(serverName, serverConfig);
        ssh = { host: server.ip, port: 22, username: "root" };

        const current = await listEnv(ssh, service);

        if (!(key in current)) {
          outputError(`Variable "${key}" not found on service "${service}"`);
          process.exit(3);
        }

        delete current[key];

        const spinner = p.spinner();
        if (!json) spinner.start(`Deleting "${key}" from "${service}"...`);

        await recreateWithEnv(ssh, service, current);

        if (!json) spinner.stop(chalk.green(`Deleted "${key}" from "${service}".`));

        if (json) {
          outputJson({ service, server: serverName, deleted: key });
        } else {
          outputSuccess(`Deleted ${key} from ${service}`);
        }
      } catch (err) {
        outputError(
          "Failed to delete environment variable",
          err instanceof Error ? err.message : err
        );
        process.exit(1);
      } finally {
        if (ssh) closeConnection(ssh);
      }
    }
  );

envCommand
  .command("import")
  .description("Import environment variables from a file")
  .argument("<service>", "Service name")
  .argument("<file>", "Path to .env file")
  .option("--server <server>", "Server name")
  .option("--json", "Output as JSON")
  .action(
    async (
      service: string,
      file: string,
      opts: { server?: string; json?: boolean }
    ) => {
      const json = opts.json || isJsonMode();
      let ssh: SSHConnectionOptions | undefined;

      try {
        const newEnv = loadEnvFile(file);
        const { serverConfig, serverName } = loadConfigAndResolve(service, opts.server);
        const server = await resolveServer(serverName, serverConfig);
        ssh = { host: server.ip, port: 22, username: "root" };

        const current = await listEnv(ssh, service);
        const merged = { ...current, ...newEnv };

        const spinner = p.spinner();
        if (!json) spinner.start(`Importing environment for "${service}"...`);

        await recreateWithEnv(ssh, service, merged);

        if (!json) spinner.stop(chalk.green(`Environment imported for "${service}".`));

        const imported = Object.keys(newEnv);
        if (json) {
          outputJson({ service, server: serverName, imported });
        } else {
          outputSuccess(`Imported ${imported.join(", ")} to ${service}`);
        }
      } catch (err) {
        outputError(
          "Failed to import environment variables",
          err instanceof Error ? err.message : err
        );
        process.exit(1);
      } finally {
        if (ssh) closeConnection(ssh);
      }
    }
  );

envCommand
  .command("export")
  .description("Export environment variables as KEY=VALUE lines")
  .argument("<service>", "Service name")
  .option("--server <server>", "Server name")
  .option("--json", "Output as JSON")
  .action(
    async (
      service: string,
      opts: { server?: string; json?: boolean }
    ) => {
      const json = opts.json || isJsonMode();
      let ssh: SSHConnectionOptions | undefined;

      try {
        const { serverConfig, serverName } = loadConfigAndResolve(service, opts.server);
        const server = await resolveServer(serverName, serverConfig);
        ssh = { host: server.ip, port: 22, username: "root" };

        const env = await listEnv(ssh, service);

        if (json) {
          outputJson({ service, env });
        } else {
          for (const [key, value] of Object.entries(env)) {
            process.stdout.write(`${key}=${value}\n`);
          }
        }
      } catch (err) {
        outputError(
          "Failed to export environment variables",
          err instanceof Error ? err.message : err
        );
        process.exit(1);
      } finally {
        if (ssh) closeConnection(ssh);
      }
    }
  );
