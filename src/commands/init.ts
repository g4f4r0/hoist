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

    ensureHoistDir();

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

    const providerCount = Object.keys(config.providers).length;
    p.outro(
      providerCount > 0
        ? `Hoist is ready with ${providerCount} provider${providerCount > 1 ? "s" : ""}. Tell your AI agent to read the Hoist skill file.`
        : "Hoist is ready. Add a provider with: hoist provider add"
    );
  });
