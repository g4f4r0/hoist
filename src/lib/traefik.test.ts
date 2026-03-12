import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./ssh.js", () => ({
  exec: vi.fn(),
  execOrFail: vi.fn(),
}));

import { addRoute, deleteRoute, listRoutes, updateRouteUpstream, generateAutoDomain, isAutoDomain, parseWwwPair } from "./traefik.js";
import { exec, execOrFail } from "./ssh.js";

const mockExec = vi.mocked(exec);
const mockExecOrFail = vi.mocked(execOrFail);
const ssh = { host: "1.2.3.4" };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("generateAutoDomain", () => {
  it("generates sslip.io domain from app name and IP", () => {
    expect(generateAutoDomain("web", "1.2.3.4")).toBe("web.1-2-3-4.sslip.io");
  });

  it("handles different IPs", () => {
    expect(generateAutoDomain("api", "10.0.0.1")).toBe("api.10-0-0-1.sslip.io");
  });
});

describe("isAutoDomain", () => {
  it("returns true for sslip.io domains", () => {
    expect(isAutoDomain("web.1-2-3-4.sslip.io")).toBe(true);
  });

  it("returns false for custom domains", () => {
    expect(isAutoDomain("example.com")).toBe(false);
    expect(isAutoDomain("www.example.com")).toBe(false);
  });
});

describe("parseWwwPair", () => {
  it("returns bare domain as canonical and www as alternate", () => {
    expect(parseWwwPair("example.com")).toEqual({
      canonical: "example.com",
      alternate: "www.example.com",
    });
  });

  it("returns www domain as canonical and bare as alternate", () => {
    expect(parseWwwPair("www.example.com")).toEqual({
      canonical: "www.example.com",
      alternate: "example.com",
    });
  });
});

describe("addRoute", () => {
  it("writes a YAML config file via SSH", async () => {
    mockExecOrFail.mockResolvedValueOnce({ stdout: "", stderr: "" });

    await addRoute(ssh, "web", "example.com", "web:3000");

    expect(mockExecOrFail).toHaveBeenCalledTimes(1);
    const cmd = mockExecOrFail.mock.calls[0][1] as string;
    expect(cmd).toContain("/etc/traefik/dynamic/web.yml");
    expect(cmd).toContain("example.com");
    expect(cmd).toContain("web:3000");
  });

  it("generates redirect middleware for custom domains", async () => {
    mockExecOrFail.mockResolvedValueOnce({ stdout: "", stderr: "" });

    await addRoute(ssh, "web", "example.com", "web:3000");

    const cmd = mockExecOrFail.mock.calls[0][1] as string;
    expect(cmd).toContain("web-www-redirect");
    expect(cmd).toContain("www.example.com");
    expect(cmd).toContain("web-redirect");
    expect(cmd).toContain("redirectRegex");
    expect(cmd).toContain("www\\.example\\.com");
    expect(cmd).toContain("permanent: true");
  });

  it("does not generate redirect middleware for sslip.io domains", async () => {
    mockExecOrFail.mockResolvedValueOnce({ stdout: "", stderr: "" });

    await addRoute(ssh, "web", "web.1-2-3-4.sslip.io", "web:3000");

    const cmd = mockExecOrFail.mock.calls[0][1] as string;
    expect(cmd).not.toContain("www-redirect");
    expect(cmd).not.toContain("redirectRegex");
    expect(cmd).not.toContain("middlewares");
  });
});

describe("deleteRoute", () => {
  it("removes the YAML file", async () => {
    mockExecOrFail.mockResolvedValueOnce({ stdout: "", stderr: "" });

    await deleteRoute(ssh, "web");

    expect(mockExecOrFail).toHaveBeenCalledTimes(1);
    const cmd = mockExecOrFail.mock.calls[0][1] as string;
    expect(cmd).toContain("rm -f /etc/traefik/dynamic/web.yml");
  });
});

describe("listRoutes", () => {
  it("returns empty array when no files exist", async () => {
    mockExec.mockResolvedValueOnce({ stdout: "", stderr: "", code: 1 });

    const routes = await listRoutes(ssh);
    expect(routes).toEqual([]);
  });

  it("parses routes from YAML files", async () => {
    mockExec.mockResolvedValueOnce({
      stdout: "/etc/traefik/dynamic/web.yml\n/etc/traefik/dynamic/api.yml\n",
      stderr: "",
      code: 0,
    });

    const webYaml = `http:
  routers:
    web:
      rule: "Host(\`example.com\`)"
      entryPoints: [websecure]
      tls:
        certResolver: letsencrypt
      service: web
    web-www-redirect:
      rule: "Host(\`www.example.com\`)"
      entryPoints: [websecure]
      tls:
        certResolver: letsencrypt
      middlewares: [web-redirect]
      service: web
  middlewares:
    web-redirect:
      redirectRegex:
        regex: "^https://www\\.example\\.com/(.*)"
        replacement: "https://example.com/\${1}"
        permanent: true
  services:
    web:
      loadBalancer:
        servers:
          - url: "http://web:3000"
`;

    const apiYaml = `http:
  routers:
    api:
      rule: "Host(\`api.1-2-3-4.sslip.io\`)"
      entryPoints: [websecure]
      tls:
        certResolver: letsencrypt
      service: api
  services:
    api:
      loadBalancer:
        servers:
          - url: "http://api:4000"
`;

    mockExecOrFail
      .mockResolvedValueOnce({ stdout: webYaml, stderr: "" })
      .mockResolvedValueOnce({ stdout: apiYaml, stderr: "" });

    const routes = await listRoutes(ssh);
    expect(routes).toEqual([
      { appName: "web", domain: "example.com", upstream: "web:3000" },
      { appName: "api", domain: "api.1-2-3-4.sslip.io", upstream: "api:4000" },
    ]);
  });
});

describe("updateRouteUpstream", () => {
  it("reads existing domain and rewrites with new upstream", async () => {
    const existingYaml = `http:
  routers:
    web:
      rule: "Host(\`example.com\`)"
      entryPoints: [websecure]
      tls:
        certResolver: letsencrypt
      service: web
  services:
    web:
      loadBalancer:
        servers:
          - url: "http://web:3000"
`;

    mockExec.mockResolvedValueOnce({ stdout: existingYaml, stderr: "", code: 0 });
    mockExecOrFail.mockResolvedValueOnce({ stdout: "", stderr: "" });

    await updateRouteUpstream(ssh, "web", "web:4000");

    expect(mockExecOrFail).toHaveBeenCalledTimes(1);
    const writeCmd = mockExecOrFail.mock.calls[0][1] as string;
    expect(writeCmd).toContain("web:4000");
    expect(writeCmd).toContain("example.com");
  });

  it("creates auto-domain route when file missing", async () => {
    mockExec.mockResolvedValueOnce({ stdout: "", stderr: "", code: 1 });
    mockExecOrFail.mockResolvedValueOnce({ stdout: "", stderr: "" });

    await updateRouteUpstream(ssh, "web", "web:4000");

    expect(mockExecOrFail).toHaveBeenCalledTimes(1);
    const writeCmd = mockExecOrFail.mock.calls[0][1] as string;
    expect(writeCmd).toContain("web:4000");
    expect(writeCmd).toContain("web.1-2-3-4.sslip.io");
  });
});
