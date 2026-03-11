import { Command } from "commander";
import * as p from "@clack/prompts";
import chalk from "chalk";
import {
  hasConfig,
  getConfig,
  getConfigPath,
  getKeysDir,
} from "../lib/config.js";
import {
  hasKeys,
  validateKeyPermissions,
} from "../lib/ssh-keys.js";
import { testProviderConnection } from "../providers/index.js";
import { outputJson } from "../lib/output.js";

type CheckResult = {
  name: string;
  status: "pass" | "fail" | "warn";
  message: string;
};

export const doctorCommand = new Command("doctor")
  .description("Health check everything")
  .option("--json", "Output as JSON")
  .action(async (opts: { json?: boolean }) => {
    const checks: CheckResult[] = [];

    if (hasConfig()) {
      checks.push({
        name: "config",
        status: "pass",
        message: `Config found at ${getConfigPath()}`,
      });
    } else {
      checks.push({
        name: "config",
        status: "fail",
        message: "No config file. Run: hoist init",
      });
    }

    if (hasKeys()) {
      try {
        validateKeyPermissions();
        checks.push({
          name: "ssh-keys",
          status: "pass",
          message: `SSH keys found at ${getKeysDir()} with correct permissions`,
        });
      } catch (err) {
        checks.push({
          name: "ssh-keys",
          status: "fail",
          message: err instanceof Error ? err.message : "SSH key validation failed",
        });
      }
    } else {
      checks.push({
        name: "ssh-keys",
        status: "fail",
        message: "SSH keys not found. Run: hoist init",
      });
    }

    if (hasConfig()) {
      const config = getConfig();
      const labels = Object.keys(config.providers);

      if (labels.length === 0) {
        checks.push({
          name: "providers",
          status: "warn",
          message: "No providers configured. Run: hoist provider add",
        });
      } else {
        for (const label of labels) {
          const provider = config.providers[label];
          const result = await testProviderConnection(
            provider.type,
            provider.apiKey
          );
          checks.push({
            name: `provider:${label}`,
            status: result.ok ? "pass" : "fail",
            message: result.ok
              ? `${label} (${provider.type}): connected`
              : `${label} (${provider.type}): ${result.message}`,
          });
        }
      }
    }

    if (opts.json) {
      outputJson({
        status: checks.every((c) => c.status !== "fail") ? "healthy" : "unhealthy",
        checks,
      });
      return;
    }

    p.intro(chalk.bold("Hoist Doctor"));

    for (const check of checks) {
      const icon =
        check.status === "pass"
          ? chalk.green("✓")
          : check.status === "warn"
            ? chalk.yellow("!")
            : chalk.red("✗");
      p.log.message(`${icon} ${check.message}`);
    }

    const failed = checks.filter((c) => c.status === "fail").length;
    p.outro(
      failed === 0
        ? chalk.green("All checks passed.")
        : chalk.red(`${failed} check${failed > 1 ? "s" : ""} failed.`)
    );

    if (failed > 0) process.exit(1);
  });
