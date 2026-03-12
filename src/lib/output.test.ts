import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { outputProgress, outputResult, outputError } from "./output.js";

let logSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  logSpy.mockRestore();
});

describe("outputProgress", () => {
  it("emits NDJSON progress line", () => {
    outputProgress("build", "compiling");
    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output.type).toBe("progress");
    expect(output.phase).toBe("build");
    expect(output.message).toBe("compiling");
    expect(output.timestamp).toBeDefined();
  });
});

describe("outputResult", () => {
  it("emits NDJSON result with data", () => {
    outputResult({ key: "value" });
    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output.type).toBe("result");
    expect(output.status).toBe("success");
    expect(output.data).toEqual({ key: "value" });
  });

  it("handles arrays", () => {
    outputResult([1, 2, 3]);
    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output.data).toEqual([1, 2, 3]);
  });

  it("handles null", () => {
    outputResult(null);
    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output.data).toBeNull();
  });

  it("includes next step when provided", () => {
    outputResult({ ok: true }, { actor: "agent", action: "deploy the app", command: "hoist deploy" });
    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output.next).toEqual({ actor: "agent", action: "deploy the app", command: "hoist deploy" });
  });

  it("omits next when not provided", () => {
    outputResult({ ok: true });
    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output.next).toBeUndefined();
  });
});

describe("outputError", () => {
  it("emits NDJSON error line", () => {
    outputError("failed");
    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output.type).toBe("error");
    expect(output.message).toBe("failed");
  });

  it("includes details when provided", () => {
    outputError("failed", "something broke");
    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output.details).toBe("something broke");
  });

  it("omits details when not provided", () => {
    outputError("failed");
    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output.details).toBeUndefined();
  });

  it("includes next step when provided", () => {
    outputError("not configured", undefined, { actor: "user", action: "Run in your terminal: HOIST_HETZNER_API_KEY=your-key hoist init" });
    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output.next).toEqual({ actor: "user", action: "Run in your terminal: HOIST_HETZNER_API_KEY=your-key hoist init" });
  });

  it("omits next when not provided", () => {
    outputError("failed", "detail");
    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output.next).toBeUndefined();
  });
});
