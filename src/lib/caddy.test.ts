import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./ssh.js", () => ({
  exec: vi.fn(),
  execOrFail: vi.fn(),
}));

import { addRoute, deleteRoute, listRoutes, updateRouteUpstream } from "./caddy.js";
import { execOrFail } from "./ssh.js";

const mockExecOrFail = vi.mocked(execOrFail);
const ssh = { host: "1.2.3.4" };

function caddyConfig(routes: Array<{ domain: string; upstream: string }>) {
  return {
    apps: {
      http: {
        servers: {
          srv0: {
            listen: [":443"],
            routes: routes.map((r) => ({
              match: [{ host: [r.domain] }],
              handle: [{ handler: "reverse_proxy", upstreams: [{ dial: r.upstream }] }],
              terminal: true,
            })),
          },
        },
      },
    },
  };
}

function mockGetConfig(config: unknown) {
  mockExecOrFail.mockResolvedValueOnce({
    stdout: JSON.stringify(config),
    stderr: "",
  });
}

function mockPutConfig() {
  mockExecOrFail.mockResolvedValueOnce({ stdout: "", stderr: "" });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("listRoutes", () => {
  it("returns empty array for null config", async () => {
    mockGetConfig(null);
    const routes = await listRoutes(ssh);
    expect(routes).toEqual([]);
  });

  it("returns empty array for empty routes", async () => {
    mockGetConfig(caddyConfig([]));
    const routes = await listRoutes(ssh);
    expect(routes).toEqual([]);
  });

  it("returns routes from config", async () => {
    mockGetConfig(caddyConfig([
      { domain: "a.com", upstream: "hoist-web:3000" },
      { domain: "b.com", upstream: "hoist-api:4000" },
    ]));
    const routes = await listRoutes(ssh);
    expect(routes).toEqual([
      { domain: "a.com", upstream: "hoist-web:3000" },
      { domain: "b.com", upstream: "hoist-api:4000" },
    ]);
  });
});

describe("addRoute", () => {
  it("adds a new route", async () => {
    mockGetConfig(caddyConfig([]));
    mockPutConfig();

    await addRoute(ssh, "example.com", "hoist-web:3000");

    expect(mockExecOrFail).toHaveBeenCalledTimes(2);
    const putCall = mockExecOrFail.mock.calls[1][1] as string;
    expect(putCall).toContain("example.com");
    expect(putCall).toContain("hoist-web:3000");
  });

  it("throws when route already exists", async () => {
    mockGetConfig(caddyConfig([{ domain: "example.com", upstream: "hoist-web:3000" }]));

    await expect(addRoute(ssh, "example.com", "other:4000")).rejects.toThrow(
      "Route for example.com already exists"
    );
  });
});

describe("deleteRoute", () => {
  it("deletes an existing route", async () => {
    mockGetConfig(caddyConfig([{ domain: "example.com", upstream: "hoist-web:3000" }]));
    mockPutConfig();

    await deleteRoute(ssh, "example.com");
    expect(mockExecOrFail).toHaveBeenCalledTimes(2);
  });

  it("throws when route not found", async () => {
    mockGetConfig(caddyConfig([]));

    await expect(deleteRoute(ssh, "missing.com")).rejects.toThrow(
      "No route found for missing.com"
    );
  });
});

describe("updateRouteUpstream", () => {
  it("updates the upstream of an existing route", async () => {
    mockGetConfig(caddyConfig([{ domain: "example.com", upstream: "hoist-web:3000" }]));
    mockPutConfig();

    await updateRouteUpstream(ssh, "example.com", "hoist-web:4000");

    const putCall = mockExecOrFail.mock.calls[1][1] as string;
    expect(putCall).toContain("hoist-web:4000");
  });

  it("throws when route not found", async () => {
    mockGetConfig(caddyConfig([]));

    await expect(updateRouteUpstream(ssh, "missing.com", "x:1")).rejects.toThrow(
      "No route found for missing.com"
    );
  });
});
