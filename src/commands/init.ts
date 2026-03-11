import { Command } from "commander";
import * as p from "@clack/prompts";
import chalk from "chalk";

import {
  hasConfig,
  ensureHoistDir,
  getConfig,
  updateConfig,
  type HoistConfig,
  type ProviderConfig,
} from "../lib/config.js";
import { generateKeys, hasKeys } from "../lib/ssh-keys.js";
import { testProviderConnection } from "../providers/index.js";
import { writeAgentConfig } from "../lib/agent-config.js";
import { detectEnvProviders } from "../lib/env-providers.js";
import { outputJson, outputError, isJsonMode } from "../lib/output.js";

const PROVIDER_TYPES = [
  { value: "hetzner", label: "Hetzner" },
  { value: "vultr", label: "Vultr" },
  { value: "digitalocean", label: "DigitalOcean" },
] as const;

type ProviderType = (typeof PROVIDER_TYPES)[number]["value"];

function formatProviderName(type: string): string {
  return type.charAt(0).toUpperCase() + type.slice(1);
}

export const initCommand = new Command("init")
  .description("Set up Hoist on this machine")
  .action(async () => {
    const json = isJsonMode();
    ensureHoistDir();

    // Auto-detect: if env vars are set, configure providers automatically
    const envProviders = detectEnvProviders();

    if (envProviders.length > 0) {
      const config: HoistConfig = getConfig();
      const results: Array<{ label: string; type: string; status: string; message?: string }> = [];

      for (const { type, apiKey, label } of envProviders) {
        if (config.providers[label]) {
          config.providers[label].apiKey = apiKey;
          results.push({ label, type, status: "updated" });
          continue;
        }

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

      if (!hasKeys()) {
        generateKeys();
      }

      updateConfig(config);
      const written = writeAgentConfig();

      if (json) {
        outputJson({
          status: "initialized",
          providers: results,
          skills: written.length,
          restart: "Restart your AI agent to pick up the new skills.",
        });
      } else {
        for (const r of results) {
          if (r.status === "failed") {
            p.log.error(`${r.label}: ${r.message}`);
          } else {
            p.log.success(`${r.label} (${r.type}): ${r.status}`);
          }
        }
        p.log.success(`Agent skills installed: ${written.length} files`);
        p.log.info(chalk.dim("Restart your AI agent to pick up the new skills."));
      }
      return;
    }

    // No env vars — interactive mode (human)
    p.intro(chalk.bold("Welcome to Hoist."));

    if (hasConfig()) {
      const overwrite = await p.confirm({
        message: "Hoist is already configured. Reinitialize?",
        initialValue: false,
      });
      if (p.isCancel(overwrite) || !overwrite) {
        p.outro("Keeping existing configuration.");
        return;
      }
    }

    const config: HoistConfig = getConfig();
    let firstProvider: string | undefined;

    let addMore = true;
    while (addMore) {
      const providerType = await p.select({
        message: !firstProvider
          ? "Add a cloud provider"
          : "Add another provider?",
        options: [
          ...PROVIDER_TYPES,
          { value: "skip" as const, label: "Done" },
        ],
      });

      if (p.isCancel(providerType) || providerType === "skip") break;

      const apiKey = await p.password({
        message: `${formatProviderName(providerType)} API key:`,
      });

      if (p.isCancel(apiKey)) break;

      const label = await p.text({
        message: "Label for this provider:",
        placeholder: `${providerType}-1`,
        defaultValue: `${providerType}-1`,
      });

      if (p.isCancel(label)) break;

      const spinner = p.spinner();
      spinner.start(`Verifying ${label}...`);

      const result = await testProviderConnection(
        providerType as ProviderType,
        apiKey
      );

      if (result.ok) {
        spinner.stop(`${label} verified (${result.message})`);
        config.providers[label] = {
          type: providerType as ProviderType,
          apiKey,
        };
        if (!firstProvider) {
          firstProvider = label;
          config.defaults.provider = label;
        }
      } else {
        spinner.stop(chalk.red(`Failed: ${result.message}`));
      }
    }

    if (!hasKeys()) {
      const spinner = p.spinner();
      spinner.start("Generating SSH key pair (ed25519)...");
      generateKeys();
      spinner.stop("SSH key pair generated.");
    } else {
      p.log.success("SSH key pair already exists.");
    }

    updateConfig(config);

    const written = writeAgentConfig();
    p.log.success(`Agent skills installed: ${written.length} files`);
    p.log.info(chalk.dim("Restart your AI agent to pick up the new skills."));

    const providerCount = Object.keys(config.providers).length;
    p.outro(
      providerCount > 0
        ? `Hoist is ready with ${providerCount} provider${providerCount > 1 ? "s" : ""}.`
        : "Hoist is ready. Add a provider with: hoist provider add"
    );
  });
