import chalk from "chalk";

import { hasConfig, getConfig } from "./config.js";
import { hasKeys } from "./ssh-keys.js";

/** Prints a quick status overview: version, auth, providers. */
export async function showStatus(version: string): Promise<void> {
  console.log(`\n  ${chalk.bold("hoist")} cli v${version}\n`);

  if (!hasConfig()) {
    console.log(`  ${chalk.red("●")} Not configured. Run: hoist init\n`);
    return;
  }

  if (hasKeys()) {
    console.log(`  ${chalk.green("●")} SSH keys ready`);
  } else {
    console.log(`  ${chalk.red("●")} SSH keys missing. Run: hoist init`);
  }

  const config = getConfig();
  const providers = Object.entries(config.providers);

  if (providers.length === 0) {
    console.log(`  ${chalk.yellow("●")} No providers configured`);
  } else {
    for (const [label, p] of providers) {
      const isDefault = config.defaults.provider === label;
      const tag = isDefault ? chalk.dim(" (default)") : "";
      console.log(`  ${chalk.green("●")} Provider: ${label} (${p.type})${tag}`);
    }
  }

  const imported = config.importedServers
    ? Object.keys(config.importedServers).length
    : 0;
  if (imported > 0) {
    console.log(`  ${chalk.green("●")} Imported servers: ${imported}`);
  }

  console.log();
}
