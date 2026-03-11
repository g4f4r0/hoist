import { Command } from "commander";
import * as p from "@clack/prompts";
import chalk from "chalk";
import {
  getConfig,
  updateConfig,
  hasConfig,
  type ProviderConfig,
} from "../lib/config.js";
import { testProviderConnection } from "../providers/index.js";
import { outputJson, outputSuccess, outputError } from "../lib/output.js";

const PROVIDER_TYPES = [
  { value: "hetzner", label: "Hetzner" },
  { value: "vultr", label: "Vultr" },
  { value: "digitalocean", label: "DigitalOcean" },
] as const;

export const providerCommand = new Command("provider").description(
  "Manage cloud providers"
);

providerCommand
  .command("add")
  .description("Add a cloud provider")
  .option("--json", "Output as JSON")
  .action(async (opts: { json?: boolean }) => {
    if (!hasConfig()) {
      outputError("Run 'hoist init' first.");
      process.exit(1);
    }

    const config = getConfig();

    const providerType = await p.select({
      message: "Provider type:",
      options: [...PROVIDER_TYPES],
    });
    if (p.isCancel(providerType)) return;

    const apiKey = await p.password({
      message: "API key:",
    });
    if (p.isCancel(apiKey)) return;

    const label = await p.text({
      message: "Label:",
      placeholder: `${providerType}-1`,
      defaultValue: `${providerType}-1`,
    });
    if (p.isCancel(label)) return;

    if (config.providers[label]) {
      outputError(`Provider "${label}" already exists.`);
      process.exit(1);
    }

    const spinner = p.spinner();
    spinner.start(`Verifying ${label}...`);

    const result = await testProviderConnection(
      providerType as ProviderConfig["type"],
      apiKey
    );

    if (result.ok) {
      spinner.stop(`${label} verified (${result.message})`);
      config.providers[label] = {
        type: providerType as ProviderConfig["type"],
        apiKey,
      };
      if (!config.defaults.provider) {
        config.defaults.provider = label;
      }
      updateConfig(config);

      if (opts.json) {
        outputJson({ status: "success", provider: label, type: providerType });
      } else {
        outputSuccess(`Provider "${label}" added.`);
      }
    } else {
      spinner.stop(chalk.red(`Verification failed: ${result.message}`));
      if (opts.json) {
        outputError("Verification failed", result.message);
      }
      process.exit(1);
    }
  });

providerCommand
  .command("list")
  .description("List configured providers")
  .option("--json", "Output as JSON")
  .action(async (opts: { json?: boolean }) => {
    const config = getConfig();
    const providers = Object.entries(config.providers).map(
      ([name, provider]) => ({
        label: name,
        type: provider.type,
        default: config.defaults.provider === name,
      })
    );

    if (opts.json) {
      outputJson(providers);
      return;
    }

    if (providers.length === 0) {
      p.log.warning("No providers configured. Run: hoist provider add");
      return;
    }

    for (const provider of providers) {
      const defaultTag = provider.default ? chalk.dim(" (default)") : "";
      p.log.info(`${chalk.bold(provider.label)} ${chalk.dim(provider.type)}${defaultTag}`);
    }
  });

providerCommand
  .command("delete")
  .description("Delete a provider")
  .argument("[label]", "Provider label to delete")
  .option("--yes", "Skip confirmation")
  .option("--json", "Output as JSON")
  .action(async (label?: string, opts?: { json?: boolean; yes?: boolean }) => {
    const config = getConfig();
    const labels = Object.keys(config.providers);

    if (labels.length === 0) {
      outputError("No providers configured.");
      process.exit(1);
    }

    let targetLabel = label;
    if (!targetLabel) {
      if (opts?.json) {
        outputError("Provider label is required with --json");
        process.exit(1);
      }
      const selected = await p.select({
        message: "Delete which provider?",
        options: labels.map((name) => ({ value: name, label: name })),
      });
      if (p.isCancel(selected)) return;
      targetLabel = selected;
    }

    if (!config.providers[targetLabel]) {
      outputError(`Provider "${targetLabel}" not found.`);
      process.exit(1);
    }

    if (!opts?.yes && !opts?.json) {
      const confirmed = await p.confirm({
        message: `Delete provider "${targetLabel}"?`,
      });
      if (p.isCancel(confirmed) || !confirmed) return;
    }

    delete config.providers[targetLabel];
    if (config.defaults.provider === targetLabel) {
      config.defaults.provider = Object.keys(config.providers)[0];
    }
    updateConfig(config);

    if (opts?.json) {
      outputJson({ status: "deleted", provider: targetLabel });
    } else {
      outputSuccess(`Provider "${targetLabel}" deleted.`);
    }
  });

providerCommand
  .command("update")
  .description("Update API key for a provider")
  .argument("[label]", "Provider label to update")
  .option("--json", "Output as JSON")
  .action(async (label?: string, opts?: { json?: boolean }) => {
    const config = getConfig();
    const labels = Object.keys(config.providers);

    if (labels.length === 0) {
      outputError("No providers configured.");
      process.exit(1);
    }

    let targetLabel = label;
    if (!targetLabel) {
      const selected = await p.select({
        message: "Update which provider?",
        options: labels.map((name) => ({ value: name, label: name })),
      });
      if (p.isCancel(selected)) return;
      targetLabel = selected;
    }

    if (!config.providers[targetLabel]) {
      outputError(`Provider "${targetLabel}" not found.`);
      process.exit(1);
    }

    const apiKey = await p.password({
      message: "New API key:",
    });
    if (p.isCancel(apiKey)) return;

    const spinner = p.spinner();
    spinner.start(`Verifying ${targetLabel}...`);

    const result = await testProviderConnection(
      config.providers[targetLabel].type,
      apiKey
    );

    if (result.ok) {
      spinner.stop(`${targetLabel} verified (${result.message})`);
      config.providers[targetLabel].apiKey = apiKey;
      updateConfig(config);

      if (opts?.json) {
        outputJson({ status: "updated", provider: targetLabel });
      } else {
        outputSuccess(`Provider "${targetLabel}" API key updated.`);
      }
    } else {
      spinner.stop(chalk.red(`Verification failed: ${result.message}`));
      if (opts?.json) {
        outputError("Verification failed", result.message);
      }
      process.exit(1);
    }
  });

providerCommand
  .command("test")
  .description("Verify provider API keys work")
  .argument("[label]", "Provider label to test")
  .option("--json", "Output as JSON")
  .action(async (label?: string, opts?: { json?: boolean }) => {
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

      if (!opts?.json) {
        const spinner = p.spinner();
        spinner.start(`Testing ${name}...`);
        const result = await testProviderConnection(provider.type, provider.apiKey);
        spinner.stop(result.ok
          ? `${name}: ${chalk.green("OK")} (${result.message})`
          : `${name}: ${chalk.red("FAILED")} (${result.message})`
        );
        results.push({ label: name, ...result });
      } else {
        const result = await testProviderConnection(provider.type, provider.apiKey);
        results.push({ label: name, ...result });
      }
    }

    if (opts?.json) {
      outputJson(results);
    }
  });

providerCommand
  .command("set-default")
  .description("Change default provider")
  .argument("[label]", "Provider label")
  .option("--json", "Output as JSON")
  .action(async (label?: string, opts?: { json?: boolean }) => {
    const config = getConfig();
    const labels = Object.keys(config.providers);

    if (labels.length === 0) {
      outputError("No providers configured.");
      process.exit(1);
    }

    let targetLabel = label;
    if (!targetLabel) {
      const selected = await p.select({
        message: "Default provider:",
        options: labels.map((name) => ({ value: name, label: name })),
      });
      if (p.isCancel(selected)) return;
      targetLabel = selected;
    }

    if (!config.providers[targetLabel]) {
      outputError(`Provider "${targetLabel}" not found.`);
      process.exit(1);
    }

    config.defaults.provider = targetLabel;
    updateConfig(config);

    if (opts?.json) {
      outputJson({ status: "success", default: targetLabel });
    } else {
      outputSuccess(`Default provider set to "${targetLabel}".`);
    }
  });
