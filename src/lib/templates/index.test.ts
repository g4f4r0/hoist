import { describe, it, expect } from "vitest";

import { getTemplate, listTemplates } from "./index.js";

describe("listTemplates", () => {
  it("returns all built-in templates", () => {
    const templates = listTemplates();
    const names = templates.map((t) => t.name);
    expect(names).toContain("postgres");
    expect(names).toContain("mysql");
    expect(names).toContain("mariadb");
    expect(names).toContain("redis");
    expect(names).toContain("mongodb");
  });

  it("returns templates with required fields", () => {
    for (const t of listTemplates()) {
      expect(t.name).toBeTruthy();
      expect(t.description).toBeTruthy();
      expect(t.image).toBeTruthy();
      expect(t.defaultVersion).toBeTruthy();
      expect(typeof t.port).toBe("number");
    }
  });
});

describe("getTemplate", () => {
  it("returns a template by name", () => {
    const t = getTemplate("postgres");
    expect(t.name).toBe("postgres");
    expect(t.port).toBe(5432);
  });

  it("throws for unknown template", () => {
    expect(() => getTemplate("oracle")).toThrow("unknown template: oracle");
  });
});
