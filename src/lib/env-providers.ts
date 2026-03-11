import type { ProviderConfig } from "./config.js";

/**
 * Environment variable names mapped to provider types.
 * These allow non-interactive provider setup (e.g. via OpenClaw, CI/CD, or shell exports).
 */
const ENV_MAP: Array<{ env: string; type: ProviderConfig["type"]; label: string }> = [
  { env: "HOIST_HETZNER_API_KEY", type: "hetzner", label: "hetzner-1" },
  { env: "HOIST_VULTR_API_KEY", type: "vultr", label: "vultr-1" },
  { env: "HOIST_DIGITALOCEAN_API_KEY", type: "digitalocean", label: "digitalocean-1" },
];

export interface DetectedProvider {
  type: ProviderConfig["type"];
  apiKey: string;
  label: string;
  env: string;
}

/**
 * Scans process.env for HOIST_*_API_KEY variables and returns
 * any detected provider credentials. Keys are never logged or
 * included in JSON output — they go straight into ~/.hoist/config.json
 * with 600 permissions.
 */
export function detectEnvProviders(): DetectedProvider[] {
  const found: DetectedProvider[] = [];

  for (const { env, type, label } of ENV_MAP) {
    const value = process.env[env];
    if (value && value.trim().length > 0) {
      found.push({ type, apiKey: value.trim(), label, env });
    }
  }

  return found;
}
