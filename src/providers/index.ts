import type { ProviderConfig } from "../lib/config.js";
import { hetznerProvider } from "./hetzner.js";
import { vultrProvider } from "./vultr.js";
import { digitaloceanProvider } from "./digitalocean.js";
import { hostingerProvider } from "./hostinger.js";
import { linodeProvider } from "./linode.js";
import { scalewayProvider } from "./scaleway.js";

export const PROVIDER_TYPES = [
  { value: "hetzner", label: "Hetzner" },
  { value: "vultr", label: "Vultr" },
  { value: "digitalocean", label: "DigitalOcean" },
  { value: "hostinger", label: "Hostinger" },
  { value: "linode", label: "Linode" },
  { value: "scaleway", label: "Scaleway" },
] as const;

export interface ProviderTestResult {
  ok: boolean;
  message: string;
}

export interface ServerInfo {
  id: string;
  name: string;
  status: string;
  ip: string;
  type: string;
  region: string;
  monthlyCost: string;
}

export interface ServerTypeInfo {
  id: string;
  description: string;
  cpus: number;
  memoryGb: number;
  diskGb: number;
  monthlyCostCents: number;
  currency: string;
  monthlyCost: string;
}

export interface RegionInfo {
  id: string;
  name: string;
  city: string;
  country: string;
  available: boolean;
}

export interface Provider {
  testConnection(apiKey: string): Promise<ProviderTestResult>;
  listRegions(apiKey: string): Promise<RegionInfo[]>;
  listServerTypes(apiKey: string): Promise<ServerTypeInfo[]>;
  createServer(
    apiKey: string,
    opts: {
      name: string;
      type: string;
      region: string;
      sshKeyPublic: string;
    }
  ): Promise<ServerInfo>;
  listServers(apiKey: string): Promise<ServerInfo[]>;
  getServer(apiKey: string, id: string): Promise<ServerInfo>;
  deleteServer(apiKey: string, id: string): Promise<void>;
}

const providers: Record<ProviderConfig["type"], Provider> = {
  hetzner: hetznerProvider,
  vultr: vultrProvider,
  digitalocean: digitaloceanProvider,
  hostinger: hostingerProvider,
  linode: linodeProvider,
  scaleway: scalewayProvider,
};

/** Returns the provider implementation for the given type. */
export function getProvider(type: ProviderConfig["type"]): Provider {
  return providers[type];
}

/** Tests a provider API connection and returns the result without throwing. */
export async function testProviderConnection(
  type: ProviderConfig["type"],
  apiKey: string
): Promise<ProviderTestResult> {
  const provider = getProvider(type);
  try {
    return await provider.testConnection(apiKey);
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : "Unknown error",
    };
  }
}
