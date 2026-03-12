import { Command } from "commander";

import {
  getConfig,
  updateConfig,
  hasConfig,
  type ProviderConfig,
} from "../lib/config.js";
import { testProviderConnection, PROVIDER_TYPES } from "../providers/index.js";
import { outputResult, outputError, outputProgress } from "../lib/output.js";
import { generateRandomName } from "../lib/random-name.js";

export const providerCommand = new Command("provider").description(
  "Manage cloud providers"
);

const validTypes = PROVIDER_TYPES.map((p) => p.value) as readonly string[];

const ENV_VAR_MAP: Record<string, string> = {
  hetzner: "HOIST_HETZNER_API_KEY",
  vultr: "HOIST_VULTR_API_KEY",
  digitalocean: "HOIST_DIGITALOCEAN_API_KEY",
  hostinger: "HOIST_HOSTINGER_API_KEY",
  linode: "HOIST_LINODE_API_KEY",
  scaleway: "HOIST_SCALEWAY_API_KEY",
};

providerCommand
  .command("add")
  .description("Add a cloud provider (reads API key from environment variable)")
  .requiredOption("--type <type>", `Provider type (${validTypes.join(", ")})`)
  .option("--label <label>", "Label for this provider")
  .action(async (opts: { type: string; label?: string }) => {
    if (!hasConfig()) {
      outputError("Run 'hoist init' first.");
      process.exit(1);
    }

    if (!validTypes.includes(opts.type)) {
      outputError(`Invalid provider type "${opts.type}". Valid types: ${validTypes.join(", ")}`);
      process.exit(2);
    }

    const envVar = ENV_VAR_MAP[opts.type];
    const apiKey = envVar ? process.env[envVar] : undefined;

    if (!apiKey) {
      outputError(
        `No API key found. Set ${envVar} before running this command.`,
        undefined,
        { actor: "user", action: `Run in your terminal: ${envVar}=your-key hoist provider add --type ${opts.type}` }
      );
      process.exit(1);
    }

    const label = opts.label ?? generateRandomName();
    const config = getConfig();

    if (config.providers[label]) {
      outputError(`Provider "${label}" already exists.`);
      process.exit(5);
    }

    outputProgress("verify", `Verifying ${label}`);

    const result = await testProviderConnection(
      opts.type as ProviderConfig["type"],
      apiKey
    );

    if (result.ok) {
      config.providers[label] = {
        type: opts.type as ProviderConfig["type"],
        apiKey,
      };
      if (!config.defaults.provider) {
        config.defaults.provider = label;
      }
      updateConfig(config);
      outputResult(
        { status: "added", provider: label, type: opts.type },
        { actor: "agent", action: "Create a server.", command: "hoist server create" }
      );
    } else {
      outputError("Verification failed", result.message);
      process.exit(1);
    }
  });

providerCommand
  .command("list")
  .description("List configured providers")
  .action(async () => {
    const config = getConfig();
    const providers = Object.entries(config.providers).map(
      ([name, provider]) => ({
        label: name,
        type: provider.type,
        default: config.defaults.provider === name,
      })
    );

    outputResult(providers);
  });

providerCommand
  .command("delete")
  .description("Delete a provider")
  .argument("<label>", "Provider label to delete")
  .option("--confirm", "Confirm destructive action")
  .action(async (label: string, opts: { confirm?: boolean }) => {
    if (!opts.confirm) {
      outputError(
        `Destructive action: this will delete provider '${label}' and its API key from config. Re-run with --confirm to proceed.`,
        undefined,
        { actor: "agent", action: "Re-run with --confirm if the user approves.", command: `hoist provider delete ${label} --confirm` }
      );
      process.exit(1);
    }

    const config = getConfig();

    if (!config.providers[label]) {
      outputError(`Provider "${label}" not found.`);
      process.exit(1);
    }

    delete config.providers[label];
    if (config.defaults.provider === label) {
      config.defaults.provider = Object.keys(config.providers)[0];
    }
    updateConfig(config);

    outputResult({ status: "deleted", provider: label });
  });

providerCommand
  .command("update")
  .description("Update API key for a provider (reads new key from environment variable)")
  .argument("<label>", "Provider label to update")
  .action(async (label: string) => {
    const config = getConfig();

    if (!config.providers[label]) {
      outputError(`Provider "${label}" not found.`);
      process.exit(1);
    }

    const providerType = config.providers[label].type;
    const envVar = ENV_VAR_MAP[providerType];
    const apiKey = envVar ? process.env[envVar] : undefined;

    if (!apiKey) {
      outputError(
        `No API key found. Set ${envVar} before running this command.`,
        undefined,
        { actor: "user", action: `Run in your terminal: ${envVar}=your-key hoist provider update ${label}` }
      );
      process.exit(1);
    }

    outputProgress("verify", `Verifying ${label}`);

    const result = await testProviderConnection(providerType, apiKey);

    if (result.ok) {
      config.providers[label].apiKey = apiKey;
      updateConfig(config);
      outputResult({ status: "updated", provider: label });
    } else {
      outputError("Verification failed", result.message);
      process.exit(1);
    }
  });

providerCommand
  .command("test")
  .description("Verify provider API keys work")
  .argument("[label]", "Provider label to test")
  .action(async (label?: string) => {
    const config = getConfig();
    const labels = label ? [label] : Object.keys(config.providers);

    if (labels.length === 0) {
      outputError("No providers configured.");
      process.exit(1);
    }

    const results: Array<{ label: string; ok: boolean; message: string }> = [];
    for (const name of labels) {
      const provider = config.providers[name];
      if (!provider) {
        results.push({ label: name, ok: false, message: "Not found" });
        continue;
      }

      const result = await testProviderConnection(provider.type, provider.apiKey);
      results.push({ label: name, ...result });
    }

    outputResult(results);
  });

providerCommand
  .command("set-default")
  .description("Change default provider")
  .argument("<label>", "Provider label")
  .action(async (label: string) => {
    const config = getConfig();

    if (!config.providers[label]) {
      outputError(`Provider "${label}" not found.`);
      process.exit(1);
    }

    config.defaults.provider = label;
    updateConfig(config);

    outputResult({ status: "success", default: label });
  });
