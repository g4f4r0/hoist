import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { setJsonMode, isJsonMode, outputJson, outputSuccess, outputError, outputInfo } from "./output.js";

let logSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  setJsonMode(false);
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  logSpy.mockRestore();
  errorSpy.mockRestore();
});

describe("json mode", () => {
  it("defaults to false", () => {
    expect(isJsonMode()).toBe(false);
  });

  it("can be toggled", () => {
    setJsonMode(true);
    expect(isJsonMode()).toBe(true);
    setJsonMode(false);
    expect(isJsonMode()).toBe(false);
  });
});

describe("outputJson", () => {
  it("writes formatted JSON to stdout", () => {
    outputJson({ key: "value" });
    expect(logSpy).toHaveBeenCalledWith(JSON.stringify({ key: "value" }, null, 2));
  });

  it("handles arrays", () => {
    outputJson([1, 2, 3]);
    expect(logSpy).toHaveBeenCalledWith(JSON.stringify([1, 2, 3], null, 2));
  });

  it("handles null", () => {
    outputJson(null);
    expect(logSpy).toHaveBeenCalledWith("null");
  });
});

describe("outputSuccess", () => {
  it("writes JSON in json mode", () => {
    setJsonMode(true);
    outputSuccess("done");
    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output.status).toBe("success");
    expect(output.message).toBe("done");
  });

  it("includes data in json mode", () => {
    setJsonMode(true);
    outputSuccess("done", { url: "https://example.com" });
    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output.data.url).toBe("https://example.com");
  });

  it("writes to stderr in human mode", () => {
    outputSuccess("done");
    expect(errorSpy).toHaveBeenCalled();
    expect(logSpy).not.toHaveBeenCalled();
  });
});

describe("outputError", () => {
  it("writes JSON in json mode", () => {
    setJsonMode(true);
    outputError("failed");
    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output.status).toBe("error");
    expect(output.message).toBe("failed");
  });

  it("includes details in json mode", () => {
    setJsonMode(true);
    outputError("failed", "something broke");
    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output.details).toBe("something broke");
  });

  it("writes to stderr in human mode", () => {
    outputError("failed");
    expect(errorSpy).toHaveBeenCalled();
    expect(logSpy).not.toHaveBeenCalled();
  });
});

describe("outputInfo", () => {
  it("writes to stderr in human mode", () => {
    outputInfo("info message");
    expect(errorSpy).toHaveBeenCalled();
  });

  it("is silent in json mode", () => {
    setJsonMode(true);
    outputInfo("info message");
    expect(errorSpy).not.toHaveBeenCalled();
    expect(logSpy).not.toHaveBeenCalled();
  });
});
