import { describe, it, expect } from "vitest";

import { parseEnvArgs } from "./container-env.js";

describe("parseEnvArgs", () => {
  it("parses KEY=VALUE pairs", () => {
    expect(parseEnvArgs(["FOO=bar", "BAZ=qux"])).toEqual({
      FOO: "bar",
      BAZ: "qux",
    });
  });

  it("handles values with equals signs", () => {
    expect(parseEnvArgs(["URL=postgres://host:5432/db?opt=1"])).toEqual({
      URL: "postgres://host:5432/db?opt=1",
    });
  });

  it("handles empty values", () => {
    expect(parseEnvArgs(["KEY="])).toEqual({ KEY: "" });
  });

  it("throws on missing equals", () => {
    expect(() => parseEnvArgs(["INVALID"])).toThrow('Invalid env format: "INVALID"');
  });

  it("throws on individual bad entries", () => {
    expect(() => parseEnvArgs(["GOOD=val", "BAD"])).toThrow('Invalid env format: "BAD"');
  });

  it("returns empty object for empty array", () => {
    expect(parseEnvArgs([])).toEqual({});
  });

  it("handles values with spaces", () => {
    expect(parseEnvArgs(["MSG=hello world"])).toEqual({ MSG: "hello world" });
  });
});
