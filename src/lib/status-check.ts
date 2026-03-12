import { hasConfig, getConfig } from "./config.js";
import { hasKeys } from "./ssh-keys.js";
import { outputResult } from "./output.js";

/** Outputs a quick status overview as NDJSON: version, auth, providers. */
export async function showStatus(version: string): Promise<void> {
  const status: Record<string, unknown> = { version };

  if (!hasConfig()) {
    status.configured = false;
    outputResult(status, { actor: "agent", action: "Run hoist init to set up.", command: "hoist init" });
    return;
  }

  status.configured = true;
  status.sshKeys = hasKeys();

  const config = getConfig();
  const providers = Object.entries(config.providers).map(([label, p]) => ({
    label,
    type: p.type,
    default: config.defaults.provider === label,
  }));
  status.providers = providers;

  const imported = config.importedServers
    ? Object.keys(config.importedServers).length
    : 0;
  status.importedServers = imported;

  outputResult(status);
}
