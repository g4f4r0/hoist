import fs from "node:fs";

import { Command } from "commander";
import * as p from "@clack/prompts";
import chalk from "chalk";

import {
  hasConfig,
  getConfig,
  getConfigPath,
  getHoistDir,
  getKeysDir,
} from "../lib/config.js";
import { hasKeys, validateKeyPermissions } from "../lib/ssh-keys.js";
import { testProviderConnection } from "../providers/index.js";
import { loadProjectConfig } from "../lib/project-config.js";
import { resolveServers } from "../lib/server-resolve.js";
import { exec, closeConnection } from "../lib/ssh.js";
import { outputJson, isJsonMode } from "../lib/output.js";

type CheckResult = {
  name: string;
  status: "pass" | "fail" | "skip";
  message?: string;
};

async function checkLocalSetup(): Promise<CheckResult[]> {
  const checks: CheckResult[] = [];

  const hoistDir = getHoistDir();
  if (fs.existsSync(hoistDir)) {
    checks.push({ name: "config-dir", status: "pass", message: `${hoistDir} exists` });
  } else {
    checks.push({ name: "config-dir", status: "fail", message: `${hoistDir} not found. Run: hoist init` });
  }

  if (hasConfig()) {
    checks.push({ name: "config-file", status: "pass", message: `Config found at ${getConfigPath()}` });
  } else {
    checks.push({ name: "config-file", status: "fail", message: "No config file. Run: hoist init" });
  }

  if (hasKeys()) {
    try {
      validateKeyPermissions();
      checks.push({ name: "ssh-keys", status: "pass", message: `SSH keys at ${getKeysDir()} with correct permissions` });
    } catch (err) {
      checks.push({
        name: "ssh-keys",
        status: "fail",
        message: err instanceof Error ? err.message : "SSH key validation failed",
      });
    }
  } else {
    checks.push({ name: "ssh-keys", status: "fail", message: "SSH keys not found. Run: hoist init" });
  }

  return checks;
}

async function checkProviders(): Promise<CheckResult[]> {
  if (!hasConfig()) {
    return [{ name: "providers", status: "skip", message: "No config file" }];
  }

  const config = getConfig();
  const labels = Object.keys(config.providers);

  if (labels.length === 0) {
    return [{ name: "providers", status: "skip", message: "No providers configured" }];
  }

  const checks: CheckResult[] = [];
  for (const label of labels) {
    const provider = config.providers[label];
    const result = await testProviderConnection(provider.type, provider.apiKey);
    checks.push({
      name: `provider:${label}`,
      status: result.ok ? "pass" : "fail",
      message: result.ok
        ? `${label} (${provider.type}) connected`
        : `${label} (${provider.type}): ${result.message}`,
    });
  }

  return checks;
}

async function checkProjectConfig(): Promise<CheckResult[]> {
  const checks: CheckResult[] = [];

  let config;
  try {
    config = loadProjectConfig();
  } catch {
    checks.push({ name: "hoist.json", status: "skip", message: "No hoist.json in current directory" });
    return checks;
  }

  checks.push({ name: "hoist.json", status: "pass", message: `Project "${config.project}" loaded` });

  let resolved: Record<string, { ip: string; id: string; provider: string }>;
  try {
    resolved = await resolveServers(config.servers);
  } catch (err) {
    checks.push({
      name: "server-resolve",
      status: "fail",
      message: err instanceof Error ? err.message : "Failed to resolve servers",
    });
    return checks;
  }

  for (const [name, info] of Object.entries(resolved)) {
    const sshOpts = { host: info.ip };

    try {
      const result = await exec(sshOpts, "echo ok");
      if (result.code === 0) {
        checks.push({ name: `ssh:${name}`, status: "pass", message: `${name} (${info.ip}) reachable via SSH` });
      } else {
        checks.push({ name: `ssh:${name}`, status: "fail", message: `${name} (${info.ip}) SSH command failed` });
        closeConnection(sshOpts);
        continue;
      }
    } catch (err) {
      checks.push({
        name: `ssh:${name}`,
        status: "fail",
        message: `${name} (${info.ip}): ${err instanceof Error ? err.message : "SSH failed"}`,
      });
      continue;
    }

    try {
      const result = await exec(sshOpts, "docker info --format '{{.ServerVersion}}'");
      if (result.code === 0 && result.stdout.trim()) {
        checks.push({ name: `docker:${name}`, status: "pass", message: `Docker ${result.stdout.trim()} running on ${name}` });
      } else {
        checks.push({ name: `docker:${name}`, status: "fail", message: `Docker not running on ${name}` });
      }
    } catch (err) {
      checks.push({
        name: `docker:${name}`,
        status: "fail",
        message: `Docker check failed on ${name}: ${err instanceof Error ? err.message : "unknown error"}`,
      });
    }

    try {
      const result = await exec(sshOpts, "docker inspect -f '{{.State.Running}}' hoist-caddy 2>/dev/null");
      if (result.code === 0 && result.stdout.trim() === "true") {
        checks.push({ name: `caddy:${name}`, status: "pass", message: `Caddy container running on ${name}` });
      } else {
        checks.push({ name: `caddy:${name}`, status: "fail", message: `Caddy container not running on ${name}` });
      }
    } catch (err) {
      checks.push({
        name: `caddy:${name}`,
        status: "fail",
        message: `Caddy check failed on ${name}: ${err instanceof Error ? err.message : "unknown error"}`,
      });
    }

    closeConnection(sshOpts);
  }

  return checks;
}

function formatChecks(checks: CheckResult[]): void {
  for (const check of checks) {
    const icon =
      check.status === "pass"
        ? chalk.green("✓")
        : check.status === "skip"
          ? chalk.yellow("–")
          : chalk.red("✗");
    p.log.message(`${icon} ${check.message ?? check.name}`);
  }
}

export const doctorCommand = new Command("doctor")
  .description("Run health checks on local setup, providers, and project")
  .action(async () => {
    const json = isJsonMode();
    const allChecks: CheckResult[] = [];

    if (!json) {
      p.intro(chalk.bold("Hoist Doctor"));
    }

    if (!json) {
      const s = p.spinner();
      s.start("Checking local setup");
      const local = await checkLocalSetup();
      allChecks.push(...local);
      s.stop("Local setup checked");
      formatChecks(local);
    } else {
      allChecks.push(...await checkLocalSetup());
    }

    if (!json) {
      const s = p.spinner();
      s.start("Checking providers");
      const providers = await checkProviders();
      allChecks.push(...providers);
      s.stop("Providers checked");
      formatChecks(providers);
    } else {
      allChecks.push(...await checkProviders());
    }

    if (!json) {
      const s = p.spinner();
      s.start("Checking project config");
      const project = await checkProjectConfig();
      allChecks.push(...project);
      s.stop("Project config checked");
      formatChecks(project);
    } else {
      allChecks.push(...await checkProjectConfig());
    }

    if (json) {
      outputJson({
        status: allChecks.every((c) => c.status !== "fail") ? "healthy" : "unhealthy",
        checks: allChecks,
      });
      return;
    }

    const failed = allChecks.filter((c) => c.status === "fail").length;
    const passed = allChecks.filter((c) => c.status === "pass").length;
    const skipped = allChecks.filter((c) => c.status === "skip").length;

    p.outro(
      failed === 0
        ? chalk.green(`All checks passed (${passed} passed, ${skipped} skipped)`)
        : chalk.red(`${failed} failed, ${passed} passed, ${skipped} skipped`)
    );

    if (failed > 0) process.exit(1);
  });
