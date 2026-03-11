import { describe, it, expect } from "vitest";

import {
  validateProjectConfig,
  isAppService,
  getDefaultServer,
  listServicesByServer,
  type AppServiceConfig,
  type DatabaseServiceConfig,
} from "./project-config.js";

const validConfig = {
  project: "myapp",
  servers: {
    prod: { provider: "hetzner" },
  },
  services: {
    web: {
      server: "prod",
      type: "app",
      source: ".",
      port: 3000,
      domain: "example.com",
    },
    db: {
      server: "prod",
      type: "postgres",
      version: "16",
    },
  },
};

describe("validateProjectConfig", () => {
  it("accepts a valid config", () => {
    const result = validateProjectConfig(validConfig);
    expect(result.project).toBe("myapp");
    expect(Object.keys(result.servers)).toEqual(["prod"]);
    expect(Object.keys(result.services)).toEqual(["web", "db"]);
  });

  it("rejects non-object input", () => {
    expect(() => validateProjectConfig("string")).toThrow("must be a JSON object");
    expect(() => validateProjectConfig(null)).toThrow("must be a JSON object");
    expect(() => validateProjectConfig(42)).toThrow("must be a JSON object");
  });

  it("rejects arrays", () => {
    expect(() => validateProjectConfig([])).toThrow("must be a JSON object");
  });

  it("rejects missing project", () => {
    expect(() =>
      validateProjectConfig({ servers: { a: { provider: "h" } }, services: {} })
    ).toThrow('"project" must be a non-empty string');
  });

  it("rejects empty project string", () => {
    expect(() =>
      validateProjectConfig({ project: "", servers: { a: { provider: "h" } }, services: {} })
    ).toThrow('"project" must be a non-empty string');
  });

  it("rejects missing servers", () => {
    expect(() =>
      validateProjectConfig({ project: "x", services: {} })
    ).toThrow('"servers" must be an object');
  });

  it("rejects empty servers", () => {
    expect(() =>
      validateProjectConfig({ project: "x", servers: {}, services: {} })
    ).toThrow("must define at least one server");
  });

  it("rejects missing services", () => {
    expect(() =>
      validateProjectConfig({ project: "x", servers: { a: { provider: "h" } } })
    ).toThrow('"services" must be an object');
  });

  it("rejects service referencing unknown server", () => {
    expect(() =>
      validateProjectConfig({
        project: "x",
        servers: { a: { provider: "hetzner" } },
        services: { web: { server: "nonexistent", type: "app", source: ".", port: 3000 } },
      })
    ).toThrow('references unknown server "nonexistent"');
  });

  it("rejects unknown service type", () => {
    expect(() =>
      validateProjectConfig({
        project: "x",
        servers: { a: { provider: "hetzner" } },
        services: { web: { server: "a", type: "oracle", version: "1" } },
      })
    ).toThrow('unknown type "oracle"');
  });

  it("validates app service with all optional fields", () => {
    const config = {
      project: "x",
      servers: { a: { provider: "h" } },
      services: {
        web: {
          server: "a",
          type: "app",
          source: "./src",
          dockerfile: "Dockerfile.prod",
          port: 8080,
          domain: "example.com",
          env_file: ".env.prod",
          healthCheck: { path: "/health", interval: 5, timeout: 30 },
          autodeploy: { enabled: true, branch: "main" },
        },
      },
    };
    const result = validateProjectConfig(config);
    const svc = result.services.web as AppServiceConfig;
    expect(svc.type).toBe("app");
    expect(svc.dockerfile).toBe("Dockerfile.prod");
    expect(svc.healthCheck?.path).toBe("/health");
    expect(svc.autodeploy?.branch).toBe("main");
  });

  it("validates database service types", () => {
    for (const type of ["postgres", "mysql", "mariadb", "redis", "mongodb"]) {
      const config = {
        project: "x",
        servers: { a: { provider: "h" } },
        services: { db: { server: "a", type, version: "1" } },
      };
      const result = validateProjectConfig(config);
      expect(result.services.db.type).toBe(type);
    }
  });

  it("rejects server with missing provider", () => {
    expect(() =>
      validateProjectConfig({
        project: "x",
        servers: { a: {} },
        services: {},
      })
    ).toThrow('"provider" must be a non-empty string');
  });

  it("accepts app service without port (worker service)", () => {
    const config = validateProjectConfig({
      project: "x",
      servers: { a: { provider: "h" } },
      services: { worker: { server: "a", type: "app", source: "." } },
    });
    expect(config.services.worker.type).toBe("app");
  });

  it("rejects app service with domain but no port", () => {
    expect(() =>
      validateProjectConfig({
        project: "x",
        servers: { a: { provider: "h" } },
        services: { web: { server: "a", type: "app", source: ".", domain: "example.com" } },
      })
    ).toThrow('"port" is required when "domain" is set');
  });

  it("accepts app service with volumes", () => {
    const config = validateProjectConfig({
      project: "x",
      servers: { a: { provider: "h" } },
      services: { worker: { server: "a", type: "app", source: ".", volumes: { data: "/app/data" } } },
    });
    expect((config.services.worker as AppServiceConfig).volumes).toEqual({ data: "/app/data" });
  });
});

describe("isAppService", () => {
  it("returns true for app services", () => {
    expect(isAppService({ server: "a", type: "app", source: ".", port: 3000 } as AppServiceConfig)).toBe(true);
  });

  it("returns false for database services", () => {
    expect(isAppService({ server: "a", type: "postgres", version: "16" } as DatabaseServiceConfig)).toBe(false);
  });
});

describe("getDefaultServer", () => {
  const config = validateProjectConfig(validConfig);

  it("returns specified server", () => {
    expect(getDefaultServer(config, "prod")).toBe("prod");
  });

  it("returns the single server when none specified", () => {
    expect(getDefaultServer(config)).toBe("prod");
  });

  it("throws when multiple servers and none specified", () => {
    const multi = validateProjectConfig({
      ...validConfig,
      servers: {
        prod: { provider: "h" },
        staging: { provider: "h" },
      },
    });
    expect(() => getDefaultServer(multi)).toThrow("Multiple servers");
  });
});

describe("listServicesByServer", () => {
  const config = validateProjectConfig(validConfig);

  it("returns services for the given server", () => {
    const result = listServicesByServer(config, "prod");
    expect(Object.keys(result)).toEqual(["web", "db"]);
  });

  it("returns empty for unknown server", () => {
    const result = listServicesByServer(config, "nonexistent");
    expect(Object.keys(result)).toEqual([]);
  });
});
