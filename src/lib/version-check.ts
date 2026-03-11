import fs from "node:fs";
import path from "node:path";

import { getHoistDir } from "./config.js";

const REGISTRY_URL = "https://registry.npmjs.org/hoist-cli/latest";
const CACHE_FILE = "version-check.json";
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 2000;

interface VersionCheckResult {
  current: string;
  latest: string;
  updateAvailable: boolean;
}

interface CachedCheck {
  latest: string;
  timestamp: number;
}

function getCachedCheck(): CachedCheck | null {
  try {
    const cachePath = path.join(getHoistDir(), CACHE_FILE);
    if (!fs.existsSync(cachePath)) return null;
    const raw = JSON.parse(fs.readFileSync(cachePath, "utf-8")) as CachedCheck;
    if (Date.now() - raw.timestamp < CHECK_INTERVAL_MS) return raw;
    return null;
  } catch {
    return null;
  }
}

function setCachedCheck(latest: string): void {
  try {
    const dir = getHoistDir();
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const cachePath = path.join(dir, CACHE_FILE);
    const data: CachedCheck = { latest, timestamp: Date.now() };
    fs.writeFileSync(cachePath, JSON.stringify(data), { mode: 0o600 });
  } catch {
    // Cache write failure is not critical
  }
}

async function fetchLatestVersion(): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const response = await fetch(REGISTRY_URL, { signal: controller.signal });
    clearTimeout(timeout);
    if (!response.ok) return null;
    const data = (await response.json()) as { version: string };
    return data.version;
  } catch {
    return null;
  }
}

function isNewer(current: string, latest: string): boolean {
  const parse = (v: string) => v.split(".").map(Number);
  const c = parse(current);
  const l = parse(latest);
  for (let i = 0; i < 3; i++) {
    if ((l[i] ?? 0) > (c[i] ?? 0)) return true;
    if ((l[i] ?? 0) < (c[i] ?? 0)) return false;
  }
  return false;
}

/** Checks if a newer version of hoist-cli is available on npm. */
export async function checkForUpdate(
  current: string
): Promise<VersionCheckResult | null> {
  try {
    const cached = getCachedCheck();
    if (cached) {
      return {
        current,
        latest: cached.latest,
        updateAvailable: isNewer(current, cached.latest),
      };
    }

    const latest = await fetchLatestVersion();
    if (!latest) return null;

    setCachedCheck(latest);
    return { current, latest, updateAvailable: isNewer(current, latest) };
  } catch {
    return null;
  }
}
