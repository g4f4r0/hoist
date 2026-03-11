/**
 * Workflow integration test: deploy and service management.
 *
 * Tests that server resolution works for both provider-backed and
 * imported servers when deploying, and that config changes don't
 * break the resolve → deploy chain.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

let tmpDir: string;
let configPath: string;
let mockConfig: Record<string, unknown> = {};

function writeConfig(data: Record<string, unknown>) {
  fs.writeFileSync(configPath, JSON.stringify(data, null, 2));
}

vi.mock("../lib/config.js", () => ({
  hasConfig: vi.fn(() => true),
  getConfig: vi.fn(() => mockConfig),
  updateConfig: vi.fn((c: Record<string, unknown>) => {
    mockConfig = c;
    writeConfig(c);
  }),
  getHoistDir: vi.fn(() => tmpDir),
  getKeysDir: vi.fn(() => path.join(tmpDir, "keys")),
  getConfigPath: vi.fn(() => configPath),
  ensureHoistDir: vi.fn(),
}));

const mockListServers = vi.fn();

vi.mock("../providers/index.js", () => ({
  getProvider: vi.fn(() => ({
    testConnection: vi.fn().mockResolvedValue({ ok: true, message: "ok" }),
    listServers: mockListServers,
    deleteServer: vi.fn(),
    listRegions: vi.fn().mockResolvedValue([]),
    listServerTypes: vi.fn().mockResolvedValue([]),
    createServer: vi.fn(),
    getServer: vi.fn(),
  })),
}));

import {
  resolveServer,
  resolveServers,
  getConfiguredProvider,
} from "../lib/server-resolve.js";

describe("deploy workflow — server resolution", () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync("/tmp/hoist-deploy-workflow-");
    configPath = path.join(tmpDir, "config.json");

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

  it("resolves a provider-backed server for deploy", async () => {
    mockListServers.mockResolvedValueOnce([
      {
        id: "srv-123",
        name: "prod",
        status: "running",
        ip: "1.2.3.4",
        type: "cx22",
        region: "fsn1",
        monthlyCost: "€3.49",
      },
    ]);

    const result = await resolveServer("prod", { provider: "hetzner-1" });
    expect(result).toEqual({
      ip: "1.2.3.4",
      id: "srv-123",
      provider: "hetzner-1",
    });
  });

  it("resolves an imported server for deploy", async () => {
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

  it("resolves multiple servers sharing one provider (batch)", async () => {
    mockListServers.mockResolvedValueOnce([
      {
        id: "srv-1",
        name: "web",
        status: "running",
        ip: "1.1.1.1",
        type: "cx22",
        region: "fsn1",
        monthlyCost: "€3.49",
      },
      {
        id: "srv-2",
        name: "api",
        status: "running",
        ip: "2.2.2.2",
        type: "cx22",
        region: "fsn1",
        monthlyCost: "€3.49",
      },
    ]);

    const result = await resolveServers({
      web: { provider: "hetzner-1" },
      api: { provider: "hetzner-1" },
    });

    expect(result.web.ip).toBe("1.1.1.1");
    expect(result.api.ip).toBe("2.2.2.2");
    // Only one API call for both servers
    expect(mockListServers).toHaveBeenCalledTimes(1);
  });

  it("throws when server name doesn't match any provider server", async () => {
    mockListServers.mockResolvedValueOnce([
      {
        id: "srv-1",
        name: "other-server",
        status: "running",
        ip: "1.1.1.1",
        type: "cx22",
        region: "fsn1",
        monthlyCost: "€3.49",
      },
    ]);

    await expect(
      resolveServer("prod", { provider: "hetzner-1" })
    ).rejects.toThrow('Server "prod" not found on provider "hetzner-1".');
  });

  it("throws for non-existent provider label", () => {
    expect(() => {
      getConfiguredProvider("nonexistent");
    }).toThrow('Provider "nonexistent" not found in config.');
  });
});
