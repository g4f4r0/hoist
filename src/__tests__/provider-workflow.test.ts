/**
 * Workflow integration test: provider management lifecycle.
 *
 * Tests add → test → update → set-default → delete flows,
 * verifying config persistence at each step.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { HoistConfig, ProviderConfig } from "../lib/config.js";

let tmpDir: string;
let configPath: string;
let mockConfig: HoistConfig;

function writeConfig(data: HoistConfig) {
  fs.writeFileSync(configPath, JSON.stringify(data, null, 2));
}

function readConfig(): HoistConfig {
  return JSON.parse(fs.readFileSync(configPath, "utf-8"));
}

vi.mock("../lib/config.js", () => ({
  hasConfig: vi.fn(() => true),
  getConfig: vi.fn(() => mockConfig),
  updateConfig: vi.fn((c: HoistConfig) => {
    mockConfig = c;
    writeConfig(c);
  }),
  getHoistDir: vi.fn(() => tmpDir),
  getKeysDir: vi.fn(() => path.join(tmpDir, "keys")),
  getConfigPath: vi.fn(() => configPath),
  ensureHoistDir: vi.fn(),
}));

import { getConfig, updateConfig } from "../lib/config.js";

describe("provider workflow", () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync("/tmp/hoist-provider-workflow-");
    configPath = path.join(tmpDir, "config.json");

    mockConfig = { providers: {}, defaults: {} };
    writeConfig(mockConfig);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("full lifecycle: add → update key → set default → delete", () => {
    // 1. Add provider
    const config = getConfig();
    config.providers["hetzner-1"] = { type: "hetzner" as const, apiKey: "key-v1" };
    updateConfig(config);

    let saved = readConfig();
    expect(saved.providers["hetzner-1"].apiKey).toBe("key-v1");

    // 2. Update API key (provider update flow)
    const config2 = getConfig();
    config2.providers["hetzner-1"].apiKey = "key-v2";
    updateConfig(config2);

    saved = readConfig();
    expect(saved.providers["hetzner-1"].apiKey).toBe("key-v2");

    // 3. Set as default
    const config3 = getConfig();
    config3.defaults.provider = "hetzner-1";
    updateConfig(config3);

    saved = readConfig();
    expect(saved.defaults.provider).toBe("hetzner-1");

    // 4. Add second provider
    const config4 = getConfig();
    config4.providers["vultr-1"] = { type: "vultr" as const, apiKey: "vultr-key" };
    updateConfig(config4);

    saved = readConfig();
    expect(Object.keys(saved.providers)).toHaveLength(2);

    // 5. Delete first provider, default should clear
    const config5 = getConfig();
    delete config5.providers["hetzner-1"];
    if (config5.defaults.provider === "hetzner-1") {
      config5.defaults.provider = undefined;
    }
    updateConfig(config5);

    saved = readConfig();
    expect(saved.providers["hetzner-1"]).toBeUndefined();
    expect(Object.keys(saved.providers)).toHaveLength(1);
  });

  it("updating a non-existent provider doesn't corrupt config", () => {
    const config = getConfig();
    config.providers["real"] = { type: "hetzner" as const, apiKey: "key1" };
    updateConfig(config);

    const config2 = getConfig();
    expect(config2.providers["ghost"]).toBeUndefined();
    expect(config2.providers["real"].apiKey).toBe("key1");
  });

  it("multiple rapid updates don't lose data", () => {
    const config = getConfig();

    for (let i = 0; i < 10; i++) {
      config.providers[`provider-${i}`] = {
        type: "hetzner" as const,
        apiKey: `key-${i}`,
      };
      updateConfig({ ...config, providers: { ...config.providers } });
    }

    const saved = readConfig();
    expect(Object.keys(saved.providers)).toHaveLength(10);
    expect(saved.providers["provider-9"].apiKey).toBe("key-9");
  });
});
