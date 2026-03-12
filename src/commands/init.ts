import chalk from "chalk";
import * as p from "@clack/prompts";
import { Command } from "commander";

import {
  ensureHoistDir,
  getConfig,
  updateConfig,
  type HoistConfig,
  type ProviderConfig,
} from "../lib/config.js";
import { generateKeys, hasKeys } from "../lib/ssh-keys.js";
import { testProviderConnection, PROVIDER_TYPES } from "../providers/index.js";
import { writeAgentConfig } from "../lib/agent-config.js";
import { detectEnvProviders } from "../lib/env-providers.js";
import { outputResult, outputProgress } from "../lib/output.js";
import { generateRandomName } from "../lib/random-name.js";

const API_GUIDE: Record<string, { url: string; permissions: string }> = {
  hetzner: {
    url: "https://docs.hetzner.com/cloud/api/getting-started/generating-api-token",
    permissions: "Read & Write on all resources",
  },
  vultr: {
    url: "https://my.vultr.com/settings/#settingsapi",
    permissions: "All permissions",
  },
  digitalocean: {
    url: "https://docs.digitalocean.com/reference/api/create-personal-access-token",
    permissions: "Read & Write scope",
  },
  hostinger: {
    url: "https://www.hostinger.com/support/10840865-what-is-hostinger-api/",
    permissions: "VPS management permissions",
  },
  linode: {
    url: "https://www.linode.com/docs/api/",
    permissions: "Read/Write access to Linodes, IPs, and SSH Keys",
  },
  scaleway: {
    url: "https://www.scaleway.com/en/docs/identity-and-access-management/iam/how-to/create-api-keys/",
    permissions: "InstancesFullAccess policy",
  },
};

function isTTY(): boolean {
  return process.stdin.isTTY === true && process.stderr.isTTY === true;
}

async function interactiveSetup(config: HoistConfig): Promise<{ label: string; type: string; status: string; message?: string } | null> {
  const banner = [
    String.raw`  _  _  ___  _  ___ _____`,
    String.raw` | || |/ _ \| |/ __|_   _|`,
    String.raw` | __ | (_) | |\__ \ | |`,
    String.raw` |_||_|\___/|_||___/ |_|`,
  ];
  process.stderr.write("\n");
  for (const line of banner) process.stderr.write(chalk.cyan(line) + "\n");
  process.stderr.write("\n");
  p.intro("Setup");

  const type = await p.select({
    message: "Cloud provider",
    options: PROVIDER_TYPES.map((pt) => ({ value: pt.value, label: pt.label })),
  });

  if (p.isCancel(type)) {
    p.cancel("Setup cancelled.");
    return null;
  }

  const guide = API_GUIDE[type];
  if (guide) {
    p.note(
      `${chalk.dim("Guide:")} ${guide.url}\n${chalk.dim("Permissions:")} ${guide.permissions}`,
      `${type} API key`
    );
  }

  const apiKey = await p.password({
    message: "Paste your API key",
  });

  if (p.isCancel(apiKey) || !apiKey) {
    p.cancel("Setup cancelled.");
    return null;
  }

  const label = generateRandomName();

  const s = p.spinner();
  s.start(`Verifying ${label}`);

  const result = await testProviderConnection(type as ProviderConfig["type"], apiKey);

  if (!result.ok) {
    s.stop(`Verification failed: ${result.message}`);
    return { label, type, status: "failed", message: result.message };
  }

  s.stop(`${label} verified`);

  config.providers[label] = { type: type as ProviderConfig["type"], apiKey };
  if (!config.defaults.provider) {
    config.defaults.provider = label;
  }

  return { label, type, status: "added" };
}

export const initCommand = new Command("init")
  .description("Set up Hoist on this machine")
  .action(async () => {
    ensureHoistDir();

    const config: HoistConfig = getConfig();
    const results: Array<{ label: string; type: string; status: string; message?: string }> = [];
    let interactive = false;

    const envProviders = detectEnvProviders();

    for (const { type, apiKey, label } of envProviders) {
      if (config.providers[label]) {
        config.providers[label].apiKey = apiKey;
        results.push({ label, type, status: "updated" });
        continue;
      }

      outputProgress("init", `Verifying ${label}`);
      const result = await testProviderConnection(type, apiKey);
      if (result.ok) {
        config.providers[label] = { type, apiKey };
        if (!config.defaults.provider) {
          config.defaults.provider = label;
        }
        results.push({ label, type, status: "added" });
      } else {
        results.push({ label, type, status: "failed", message: result.message });
      }
    }

    const hasProvidersFromEnv = results.length > 0 || Object.keys(config.providers).length > 0;

    if (!hasProvidersFromEnv && isTTY()) {
      interactive = true;
      const result = await interactiveSetup(config);
      if (result) {
        results.push(result);
      }
    }

    if (!hasKeys()) {
      generateKeys();
    }

    updateConfig(config);
    writeAgentConfig();

    const hasProviders = results.some((r) => r.status === "added" || r.status === "updated") || Object.keys(config.providers).length > 0;

    if (interactive && hasProviders) {
      p.outro(`All set! Go back to your AI agent and tell it: ${chalk.yellow("hoist init is done")}`);
      return;
    }

    if (interactive && !hasProviders) {
      p.outro("Setup incomplete. Try again with a valid API key.");
      return;
    }

    outputResult(
      {
        status: hasProviders ? "ready" : "needs_provider",
        providers: results,
      },
      hasProviders
        ? { actor: "agent", action: "Create a server.", command: "hoist server create" }
        : { actor: "user", action: "Run 'hoist init' in your terminal to set up a provider." }
    );
  });
