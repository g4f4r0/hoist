import { Command } from "commander";

import { listEnv, recreateWithEnv, parseEnvArgs } from "../lib/container-env.js";
import { loadEnvFile } from "../lib/deploy.js";
import { resolveServer } from "../lib/server-resolve.js";
import { loadProjectConfig, getServerForService } from "../lib/project-config.js";
import { closeConnection, type SSHConnectionOptions } from "../lib/ssh.js";
import { outputResult, outputError, outputProgress } from "../lib/output.js";

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

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf-8");
}

envCommand
  .command("set")
  .description("Set environment variables on a service")
  .argument("<service>", "Service name")
  .argument("[vars...]", "KEY=VALUE pairs")
  .option("--server <server>", "Server name")
  .option("--stdin", "Read KEY=VALUE pairs from stdin")
  .action(
    async (
      service: string,
      vars: string[],
      opts: { server?: string; stdin?: boolean }
    ) => {
      let ssh: SSHConnectionOptions | undefined;

      try {
        const { serverConfig, serverName } = loadConfigAndResolve(service, opts.server);
        const server = await resolveServer(serverName, serverConfig);
        ssh = { host: server.ip, port: 22, username: "root" };

        let newEnv: Record<string, string>;

        if (opts.stdin) {
          const input = await readStdin();
          const lines = input.split("\n").filter((l) => {
            const trimmed = l.trim();
            return trimmed && !trimmed.startsWith("#");
          });
          newEnv = parseEnvArgs(lines);
        } else {
          newEnv = parseEnvArgs(vars);
        }

        const current = await listEnv(ssh, service);
        const merged = { ...current, ...newEnv };

        outputProgress("env", `Updating environment for "${service}"`);

        await recreateWithEnv(ssh, service, merged);

        const updated = Object.keys(newEnv);
        outputResult({ service, server: serverName, updated });
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
  .action(
    async (
      service: string,
      key: string,
      opts: { server?: string }
    ) => {
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

        outputResult({ service, key, value });
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
  .action(
    async (
      service: string,
      opts: { server?: string }
    ) => {
      let ssh: SSHConnectionOptions | undefined;

      try {
        const { serverConfig, serverName } = loadConfigAndResolve(service, opts.server);
        const server = await resolveServer(serverName, serverConfig);
        ssh = { host: server.ip, port: 22, username: "root" };

        const env = await listEnv(ssh, service);
        outputResult({ service, env });
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
  .action(
    async (
      service: string,
      key: string,
      opts: { server?: string }
    ) => {
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

        outputProgress("env", `Deleting "${key}" from "${service}"`);

        await recreateWithEnv(ssh, service, current);

        outputResult({ service, server: serverName, deleted: key });
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
  .action(
    async (
      service: string,
      file: string,
      opts: { server?: string }
    ) => {
      let ssh: SSHConnectionOptions | undefined;

      try {
        const newEnv = loadEnvFile(file);
        const { serverConfig, serverName } = loadConfigAndResolve(service, opts.server);
        const server = await resolveServer(serverName, serverConfig);
        ssh = { host: server.ip, port: 22, username: "root" };

        const current = await listEnv(ssh, service);
        const merged = { ...current, ...newEnv };

        outputProgress("env", `Importing environment for "${service}"`);

        await recreateWithEnv(ssh, service, merged);

        const imported = Object.keys(newEnv);
        outputResult({ service, server: serverName, imported });
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
  .action(
    async (
      service: string,
      opts: { server?: string }
    ) => {
      let ssh: SSHConnectionOptions | undefined;

      try {
        const { serverConfig, serverName } = loadConfigAndResolve(service, opts.server);
        const server = await resolveServer(serverName, serverConfig);
        ssh = { host: server.ip, port: 22, username: "root" };

        const env = await listEnv(ssh, service);
        outputResult({ service, env });
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
