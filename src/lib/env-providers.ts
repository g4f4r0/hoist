import type { ProviderConfig } from "./config.js";
import { generateRandomName } from "./random-name.js";

const ENV_MAP: Array<{ env: string; type: ProviderConfig["type"] }> = [
  { env: "HOIST_HETZNER_API_KEY", type: "hetzner" },
  { env: "HOIST_VULTR_API_KEY", type: "vultr" },
  { env: "HOIST_DIGITALOCEAN_API_KEY", type: "digitalocean" },
  { env: "HOIST_HOSTINGER_API_KEY", type: "hostinger" },
  { env: "HOIST_LINODE_API_KEY", type: "linode" },
  { env: "HOIST_SCALEWAY_API_KEY", type: "scaleway" },
];

export interface DetectedProvider {
  type: ProviderConfig["type"];
  apiKey: string;
  label: string;
  env: string;
}

/** Scans process.env for HOIST_*_API_KEY variables and returns detected provider credentials. */
export function detectEnvProviders(): DetectedProvider[] {
  const found: DetectedProvider[] = [];

  for (const { env, type } of ENV_MAP) {
    const value = process.env[env];
    if (value && value.trim().length > 0) {
      const label = generateRandomName();
      found.push({ type, apiKey: value.trim(), label, env });
    }
  }

  return found;
}
