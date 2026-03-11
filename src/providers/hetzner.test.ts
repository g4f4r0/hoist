import { describe, it, expect, vi, beforeEach } from "vitest";

import { hetznerProvider } from "./hetzner.js";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

beforeEach(() => {
  vi.clearAllMocks();
});

function mockResponse(data: unknown, status = 200) {
  mockFetch.mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  });
}

describe("testConnection", () => {
  it("returns ok with region count", async () => {
    mockResponse({
      locations: [
        { id: 1, name: "fsn1", description: "Falkenstein", city: "Falkenstein", country: "DE" },
        { id: 2, name: "nbg1", description: "Nuremberg", city: "Nuremberg", country: "DE" },
      ],
    });

    const result = await hetznerProvider.testConnection("test-key");
    expect(result.ok).toBe(true);
    expect(result.message).toBe("2 regions available");
  });

  it("sends auth header", async () => {
    mockResponse({ locations: [] });
    await hetznerProvider.testConnection("my-key");

    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.hetzner.cloud/v1/locations",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer my-key",
        }),
      })
    );
  });

  it("returns error on auth failure", async () => {
    mockResponse({ error: { message: "unauthorized" } }, 401);
    const result = await hetznerProvider.testConnection("bad-key");
    expect(result.ok).toBe(false);
    expect(result.message).toContain("Invalid API key");
  });
});

describe("listServers", () => {
  it("filters by hoist label", async () => {
    mockResponse({ servers: [] });
    await hetznerProvider.listServers("key");
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("label_selector=managed-by%3Dhoist"),
      expect.anything()
    );
  });

  it("formats server response", async () => {
    mockResponse({
      servers: [
        {
          id: 123,
          name: "web-1",
          status: "running",
          public_net: { ipv4: { ip: "1.2.3.4" } },
          server_type: { name: "cx22", description: "CX22" },
          datacenter: { name: "fsn1-dc14", location: { name: "fsn1" } },
          labels: { "managed-by": "hoist" },
        },
      ],
    });

    const servers = await hetznerProvider.listServers("key");
    expect(servers).toHaveLength(1);
    expect(servers[0]).toEqual({
      id: "123",
      name: "web-1",
      status: "running",
      ip: "1.2.3.4",
      type: "cx22",
      region: "fsn1",
      monthlyCost: "",
    });
  });
});

describe("listRegions", () => {
  it("maps location fields", async () => {
    mockResponse({
      locations: [
        { id: 1, name: "fsn1", description: "Falkenstein DC Park 1", city: "Falkenstein", country: "DE" },
      ],
    });

    const regions = await hetznerProvider.listRegions("key");
    expect(regions).toEqual([
      { id: "fsn1", name: "Falkenstein DC Park 1", city: "Falkenstein", country: "DE" },
    ]);
  });
});

describe("listServerTypes", () => {
  it("filters to cx and cax types", async () => {
    mockResponse({
      server_types: [
        { id: 1, name: "cx22", description: "CX22", cores: 2, memory: 4, disk: 40, prices: [{ location: "fsn1", price_monthly: { gross: "4.35" } }] },
        { id: 2, name: "cax11", description: "CAX11", cores: 2, memory: 4, disk: 40, prices: [{ location: "fsn1", price_monthly: { gross: "3.29" } }] },
        { id: 3, name: "ccx13", description: "CCX13", cores: 2, memory: 8, disk: 80, prices: [] },
      ],
    });

    const types = await hetznerProvider.listServerTypes("key");
    const names = types.map((t) => t.id);
    expect(names).toContain("cx22");
    expect(names).toContain("cax11");
    expect(names).not.toContain("ccx13");
  });

  it("formats monthly cost", async () => {
    mockResponse({
      server_types: [
        { id: 1, name: "cx22", description: "CX22", cores: 2, memory: 4, disk: 40, prices: [{ location: "fsn1", price_monthly: { gross: "4.35" } }] },
      ],
    });

    const types = await hetznerProvider.listServerTypes("key");
    expect(types[0].monthlyCost).toBe("€4.35");
  });
});

describe("deleteServer", () => {
  it("sends DELETE request", async () => {
    mockResponse({});
    await hetznerProvider.deleteServer("key", "456");

    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.hetzner.cloud/v1/servers/456",
      expect.objectContaining({ method: "DELETE" })
    );
  });
});
