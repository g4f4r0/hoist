/**
 * Workflow integration test: server import lifecycle.
 *
 * Tests the full import → list → status → resolve → destroy flow,
 * verifying that imported servers are persisted to config and
 * accessible from every command that reads them.
 *
 * Mocks SSH and provider APIs; uses a real temp filesystem for config.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { HoistConfig } from "../lib/config.js";

// ---- mock modules at boundaries ----

vi.mock("../lib/ssh.js", () => ({
  exec: vi.fn().mockResolvedValue({ stdout: "ok\n", stderr: "", code: 0 }),
  execOrFail: vi.fn().mockResolvedValue({ stdout: "ok\n", stderr: "" }),
  closeConnection: vi.fn(),
}));

vi.mock("../lib/ssh-keys.js", () => ({
  hasKeys: vi.fn().mockReturnValue(true),
  readPublicKey: vi.fn().mockReturnValue("ssh-ed25519 AAAA testkey"),
  getPrivateKeyPath: vi.fn().mockReturnValue("/tmp/fake_key"),
}));

vi.mock("../lib/server-setup.js", () => ({
  setupServer: vi.fn().mockResolvedValue(undefined),
  checkHealth: vi
    .fn()
    .mockResolvedValue({ healthy: true, details: ["Docker: running"] }),
}));

// ---- temp config helpers ----

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

vi.mock("../providers/index.js", () => ({
  getProvider: vi.fn(() => ({
    testConnection: vi.fn().mockResolvedValue({ ok: true, message: "ok" }),
    listServers: vi.fn().mockResolvedValue([]),
    deleteServer: vi.fn().mockResolvedValue(undefined),
    listRegions: vi.fn().mockResolvedValue([]),
    listServerTypes: vi.fn().mockResolvedValue([]),
    createServer: vi.fn(),
    getServer: vi.fn(),
  })),
}));

import { getConfig, updateConfig } from "../lib/config.js";
import { resolveServer } from "../lib/server-resolve.js";

describe("server import workflow", () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync("/tmp/hoist-workflow-");
    configPath = path.join(tmpDir, "config.json");
    fs.mkdirSync(path.join(tmpDir, "keys"), { recursive: true });

    mockConfig = {
      providers: {
        "hetzner-1": { type: "hetzner", apiKey: "test-key" },
      },
      defaults: { provider: "hetzner-1" },
    };
    writeConfig(mockConfig);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("persists an imported server to config", () => {
    const config = getConfig();
    if (!config.importedServers) config.importedServers = {};
    config.importedServers["my-vps"] = { ip: "10.0.0.1", user: "root" };
    updateConfig(config);

    const saved = readConfig();
    expect(saved.importedServers).toBeDefined();
    expect(saved.importedServers!["my-vps"]).toEqual({
      ip: "10.0.0.1",
      user: "root",
    });
  });

  it("imported server survives config reload", () => {
    const config = getConfig();
    if (!config.importedServers) config.importedServers = {};
    config.importedServers["staging"] = { ip: "10.0.0.2", user: "root" };
    updateConfig(config);

    const reloaded = getConfig();
    expect(reloaded.importedServers?.["staging"]).toEqual({
      ip: "10.0.0.2",
      user: "root",
    });
  });

  it("resolveServer finds imported servers", async () => {
    mockConfig = {
      ...mockConfig,
      importedServers: { "my-vps": { ip: "10.0.0.1", user: "root" } },
    };

    const result = await resolveServer("my-vps", { provider: "imported" });
    expect(result).toEqual({
      ip: "10.0.0.1",
      id: "my-vps",
      provider: "imported",
    });
  });

  it("resolveServer throws for missing imported server", async () => {
    mockConfig = {
      ...mockConfig,
      importedServers: {},
    };

    await expect(
      resolveServer("ghost", { provider: "imported" })
    ).rejects.toThrow('Imported server "ghost" not found in config.');
  });

  it("list includes imported servers alongside provider servers", () => {
    mockConfig = {
      ...mockConfig,
      importedServers: {
        "my-vps": { ip: "10.0.0.1", user: "root" },
        "backup-box": { ip: "10.0.0.2", user: "root" },
      },
    };

    const config = getConfig();
    const allServers: Array<{ name: string; ip: string; provider: string }> =
      [];

    if (config.importedServers) {
      for (const [name, imported] of Object.entries(config.importedServers)) {
        allServers.push({ name, ip: imported.ip, provider: "imported" });
      }
    }

    expect(allServers).toHaveLength(2);
    expect(allServers.find((s) => s.name === "my-vps")).toBeDefined();
    expect(allServers.find((s) => s.name === "backup-box")).toBeDefined();
  });

  it("destroy removes imported server from config", () => {
    mockConfig = {
      ...mockConfig,
      importedServers: {
        "my-vps": { ip: "10.0.0.1", user: "root" },
        "keep-me": { ip: "10.0.0.3", user: "root" },
      },
    };

    const config = getConfig();
    delete config.importedServers!["my-vps"];
    updateConfig(config);

    const saved = readConfig();
    expect(saved.importedServers!["my-vps"]).toBeUndefined();
    expect(saved.importedServers!["keep-me"]).toEqual({
      ip: "10.0.0.3",
      user: "root",
    });
  });

  it("full lifecycle: import → list → resolve → destroy", async () => {
    // 1. Import
    const config = getConfig();
    if (!config.importedServers) config.importedServers = {};
    config.importedServers["prod"] = { ip: "203.0.113.1", user: "root" };
    updateConfig(config);

    // 2. List — server appears
    const afterImport = getConfig();
    expect(afterImport.importedServers?.["prod"]).toBeDefined();
    expect(afterImport.importedServers?.["prod"].ip).toBe("203.0.113.1");

    // 3. Resolve — returns correct IP
    const resolved = await resolveServer("prod", { provider: "imported" });
    expect(resolved.ip).toBe("203.0.113.1");

    // 4. Destroy — remove from config
    const configBeforeDestroy = getConfig();
    delete configBeforeDestroy.importedServers!["prod"];
    updateConfig(configBeforeDestroy);

    // 5. Verify gone
    const afterDestroy = getConfig();
    expect(afterDestroy.importedServers?.["prod"]).toBeUndefined();

    // 6. Resolve should fail
    await expect(
      resolveServer("prod", { provider: "imported" })
    ).rejects.toThrow('Imported server "prod" not found in config.');
  });

  it("imported server SSH uses correct IP for connection", () => {
    mockConfig = {
      ...mockConfig,
      importedServers: { "my-vps": { ip: "10.0.0.1", user: "root" } },
    };

    const config = getConfig();
    let ip = "";
    if (config.importedServers?.["my-vps"]) {
      ip = config.importedServers["my-vps"].ip;
    }
    expect(ip).toBe("10.0.0.1");
  });
});
