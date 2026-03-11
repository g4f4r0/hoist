import { Command } from "commander";

import { resolveServer } from "../lib/server-resolve.js";
import { loadProjectConfig } from "../lib/project-config.js";
import { exec, closeConnection, type SSHConnectionOptions } from "../lib/ssh.js";
import { outputJson, outputError } from "../lib/output.js";

export const logsCommand = new Command("logs")
  .description("View container logs")
  .argument("<service>", "Service name")
  .requiredOption("--server <server>", "Server name")
  .option("--lines <n>", "Number of lines", "100")
  .option("--follow", "Follow log output")
  .option("--json", "Output as JSON")
  .action(
    async (
      service: string,
      opts: { server: string; lines: string; follow?: boolean; json?: boolean }
    ) => {
      if (opts.follow && opts.json) {
        outputError("--json is incompatible with --follow");
        process.exit(1);
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

      const container = `hoist-${service}`;
      const lines = parseInt(opts.lines, 10);
      if (isNaN(lines) || lines < 1) {
        outputError("--lines must be a positive integer");
        process.exit(1);
      }

      const cmd = opts.follow
        ? `docker logs ${container} --tail ${lines} -f`
        : `docker logs ${container} --tail ${lines}`;

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

          if (opts.json) {
            outputJson({
              service,
              server: opts.server,
              lines: result.stdout.split("\n"),
            });
          } else {
            process.stdout.write(result.stdout);
          }
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
