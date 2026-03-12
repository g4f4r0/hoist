import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export interface ProviderConfig {
  type: "hetzner" | "vultr" | "digitalocean" | "hostinger" | "linode" | "scaleway";
  apiKey: string;
}

export interface ImportedServer {
  ip: string;
  user: string;
}

export interface HoistConfig {
  providers: Record<string, ProviderConfig>;
  defaults: {
    provider?: string;
  };
  importedServers?: Record<string, ImportedServer>;
}

const HOIST_DIR = path.join(os.homedir(), ".hoist");
const CONFIG_PATH = path.join(HOIST_DIR, "config.json");
const KEYS_DIR = path.join(HOIST_DIR, "keys");

/** Returns the path to the hoist configuration directory. */
export function getHoistDir(): string {
  return HOIST_DIR;
}

/** Returns the path to the SSH keys directory. */
export function getKeysDir(): string {
  return KEYS_DIR;
}

/** Returns the path to the config file. */
export function getConfigPath(): string {
  return CONFIG_PATH;
}

/** Returns true if the config file exists on disk. */
export function hasConfig(): boolean {
  return fs.existsSync(CONFIG_PATH);
}

/** Reads and parses the hoist config, or returns an empty default. */
export function getConfig(): HoistConfig {
  if (!hasConfig()) {
    return { providers: {}, defaults: {} };
  }
  const raw = fs.readFileSync(CONFIG_PATH, "utf-8");
  return JSON.parse(raw) as HoistConfig;
}

/** Writes the hoist config to disk with restricted permissions. */
export function updateConfig(config: HoistConfig): void {
  fs.mkdirSync(HOIST_DIR, { recursive: true, mode: 0o700 });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), {
    mode: 0o600,
  });
}

/** Creates the hoist and keys directories if they do not exist. */
export function ensureHoistDir(): void {
  fs.mkdirSync(HOIST_DIR, { recursive: true, mode: 0o700 });
  fs.mkdirSync(KEYS_DIR, { recursive: true, mode: 0o700 });
}
