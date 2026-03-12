import { describe, it, expect } from "vitest";

import { resolveTemplate, generatePassword } from "./template.js";
import { postgres } from "./templates/postgres.js";
import type { Template } from "./template.js";

describe("generatePassword", () => {
  it("returns a string of the requested length", () => {
    expect(generatePassword(16)).toHaveLength(16);
    expect(generatePassword(64)).toHaveLength(64);
  });

  it("defaults to 32 characters", () => {
    expect(generatePassword()).toHaveLength(32);
  });

  it("contains only alphanumeric characters", () => {
    const pw = generatePassword(100);
    expect(pw).toMatch(/^[A-Za-z0-9]+$/);
  });

  it("generates unique values", () => {
    const a = generatePassword();
    const b = generatePassword();
    expect(a).not.toBe(b);
  });
});

describe("resolveTemplate", () => {
  it("resolves container name to service name", () => {
    const result = resolveTemplate(postgres, "mydb");
    expect(result.containerName).toBe("mydb");
  });

  it("resolves image with default version", () => {
    const result = resolveTemplate(postgres, "mydb");
    expect(result.image).toBe("postgres:16-alpine");
  });

  it("resolves image with custom version", () => {
    const result = resolveTemplate(postgres, "mydb", "15");
    expect(result.image).toBe("postgres:15-alpine");
  });

  it("resolves port from template", () => {
    const result = resolveTemplate(postgres, "mydb");
    expect(result.port).toBe(5432);
  });

  it("resolves {{generate:username}} to hoist", () => {
    const result = resolveTemplate(postgres, "mydb");
    expect(result.env.POSTGRES_USER).toBe("hoist");
  });

  it("resolves {{generate:password}} to alphanumeric string", () => {
    const result = resolveTemplate(postgres, "mydb");
    expect(result.env.POSTGRES_PASSWORD).toMatch(/^[A-Za-z0-9]+$/);
    expect(result.env.POSTGRES_PASSWORD.length).toBe(32);
  });

  it("preserves static env values", () => {
    const result = resolveTemplate(postgres, "mydb");
    expect(result.env.POSTGRES_DB).toBe("app");
  });

  it("resolves {{env:*}} in connectionString", () => {
    const result = resolveTemplate(postgres, "mydb");
    expect(result.connectionString).toContain("hoist:");
    expect(result.connectionString).toContain("mydb");
    expect(result.connectionString).toContain("5432");
    expect(result.connectionString).toContain("/app");
    expect(result.connectionString).not.toContain("{{");
  });

  it("resolves {{container}} in connectionString", () => {
    const result = resolveTemplate(postgres, "mydb");
    expect(result.connectionString).toContain("mydb:");
  });

  it("maps volumes with service name prefix", () => {
    const result = resolveTemplate(postgres, "mydb");
    expect(result.volumes["/var/lib/postgresql/data"]).toBe("mydb-data");
  });

  it("sets labels", () => {
    const result = resolveTemplate(postgres, "mydb");
    expect(result.labels).toEqual({
      "managed-by": "hoist",
      "hoist.service": "mydb",
    });
  });

  it("resolves healthCheck with env references", () => {
    const result = resolveTemplate(postgres, "mydb");
    expect(result.healthCheck).toBe("pg_isready -U hoist");
  });

  it("handles template with no connectionString", () => {
    const minimal: Template = {
      name: "test",
      description: "Test",
      image: "test:{{version}}",
      defaultVersion: "1",
      port: 8080,
      volumes: {},
      env: {},
    };
    const result = resolveTemplate(minimal, "svc");
    expect(result.connectionString).toBe("");
    expect(result.healthCheck).toBe("");
    expect(result.command).toBe("");
  });

  it("handles template with command", () => {
    const withCmd: Template = {
      name: "test",
      description: "Test",
      image: "test:{{version}}",
      defaultVersion: "1",
      port: 8080,
      volumes: {},
      env: {},
      command: "--flag={{version}}",
    };
    const result = resolveTemplate(withCmd, "svc");
    expect(result.command).toBe("--flag=1");
  });
});
