import { Command } from "commander";

import { loadProjectConfig, isAppService, getDefaultServer, type AppServiceConfig } from "../lib/project-config.js";
import { resolveServer, resolveServers } from "../lib/server-resolve.js";
import { closeConnection, type SSHConnectionOptions } from "../lib/ssh.js";
import { deployService } from "../lib/deploy.js";
import { createDatabase, formatSshTunnel } from "../lib/database.js";
import { getTemplate } from "../lib/templates/index.js";
import { generateRandomName } from "../lib/random-name.js";
import { outputResult, outputError, outputProgress } from "../lib/output.js";

interface DeployResult {
  service: string;
  server: string;
  status: "running" | "failed";
  image: string;
  url: string;
  error?: string;
}

export const deployCommand = new Command("deploy")
  .description("Deploy services to servers")
  .option("--service <name>", "Deploy a specific service")
  .option("--template <type>", "Deploy a template service (e.g. postgres, redis)")
  .option("--name <name>", "Name for the template instance (used with --template)")
  .option("--server <server>", "Target server (used with --template)")
  .option("--version <version>", "Template version override (used with --template)")
  .option("--public", "Expose template service port publicly")
  .option("--repo <url>", "Deploy from a git repository URL")
  .option("--branch <branch>", "Git branch to deploy", "main")
  .action(async (opts: { service?: string; template?: string; name?: string; server?: string; version?: string; public?: boolean; repo?: string; branch: string }) => {
    if (opts.template) {
      await deployTemplate(opts.template, opts.name, opts.server, opts.version, opts.public);
      return;
    }

    let config;
    try {
      config = loadProjectConfig();
    } catch (err) {
      outputError(err instanceof Error ? err.message : "Failed to load project config");
      process.exit(1);
    }

    const appServices = Object.entries(config.services).filter(
      (entry): entry is [string, AppServiceConfig] => isAppService(entry[1])
    );

    if (appServices.length === 0) {
      outputError("No app services found in hoist.json");
      process.exit(1);
    }

    let servicesToDeploy: Array<[string, AppServiceConfig]>;

    if (opts.service) {
      const match = appServices.find(([name]) => name === opts.service);
      if (!match) {
        outputError(`Service "${opts.service}" not found or is not an app service`);
        process.exit(1);
      }
      servicesToDeploy = [match];
    } else {
      servicesToDeploy = appServices;
    }

    let resolved;
    try {
      resolved = await resolveServers(config.servers);
    } catch (err) {
      outputError(err instanceof Error ? err.message : "Failed to resolve servers");
      process.exit(1);
    }

    const results: DeployResult[] = [];

    for (const [name, service] of servicesToDeploy) {
      const server = resolved[service.server];
      const ssh: SSHConnectionOptions = {
        host: server.ip,
        port: 22,
        username: "root",
      };

      outputProgress("deploy", `Deploying ${name}`);

      try {
        const result = await deployService({
          ssh,
          serviceName: name,
          service,
          sourceDir: process.cwd(),
          repo: opts.repo,
          branch: opts.branch,
          onLog: (msg) => {
            outputProgress("deploy", msg);
          },
        });
        results.push(result);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Deploy failed";
        results.push({
          service: name,
          server: service.server,
          status: "failed",
          image: "",
          url: "",
          error: message,
        });
      } finally {
        closeConnection(ssh);
      }
    }

    const failed = results.filter((r) => r.status === "failed");
    if (failed.length > 0) {
      outputResult(results);
      process.exit(1);
    }

    outputResult(results, { actor: "agent", action: "Check status or add a custom domain.", command: "hoist status" });
  });

async function deployTemplate(
  templateType: string,
  name: string | undefined,
  serverFlag: string | undefined,
  version: string | undefined,
  isPublic?: boolean
): Promise<void> {
  try {
    getTemplate(templateType);
  } catch {
    outputError(`Template "${templateType}" not found`);
    process.exit(3);
  }

  const serviceName = name ?? generateRandomName();

  let config;
  try {
    config = loadProjectConfig();
  } catch (err) {
    outputError(err instanceof Error ? err.message : "Failed to load project config");
    process.exit(1);
  }

  let serverName = serverFlag;
  if (!serverName) {
    try {
      serverName = getDefaultServer(config);
    } catch {
      outputError("Multiple servers. Use --server to specify one.");
      process.exit(1);
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

  outputProgress("template", `Creating ${templateType} service "${serviceName}"`);

  try {
    const result = await createDatabase({
      ssh,
      serviceName,
      templateName: templateType,
      version,
      public: isPublic,
      onLog: (msg) => {
        outputProgress("template", msg);
      },
    });

    const sshTunnel = formatSshTunnel(server.ip, result.container, result.port);

    const output: Record<string, unknown> = {
      service: result.service,
      type: result.type,
      version: result.version,
      connectionString: result.connectionString,
      sshTunnel,
      public: result.public,
      status: result.status,
      server: serverName,
    };

    if (result.publicConnectionString) {
      output.publicConnectionString = result.publicConnectionString;
    }

    const connStr = result.publicConnectionString || result.connectionString;
    outputResult(
      output,
      { actor: "agent", action: "Set the connection string as an env var on your app.", command: `hoist env set <service> DATABASE_URL=${connStr}` }
    );
  } catch (err) {
    outputError("Service creation failed", err instanceof Error ? err.message : err);
    process.exit(1);
  } finally {
    closeConnection(ssh);
  }
}
