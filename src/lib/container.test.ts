import { describe, it, expect } from "vitest";

import { containerName, imageName, buildDockerRunCmd } from "./container.js";

describe("containerName", () => {
  it("prefixes with hoist-", () => {
    expect(containerName("web")).toBe("hoist-web");
    expect(containerName("api-server")).toBe("hoist-api-server");
  });
});

describe("imageName", () => {
  it("prefixes with hoist-", () => {
    expect(imageName("web")).toBe("hoist-web");
  });
});

describe("buildDockerRunCmd", () => {
  it("builds basic run command", () => {
    const cmd = buildDockerRunCmd("hoist-web", "hoist-web:latest", {});
    expect(cmd).toBe(
      "docker run -d --name hoist-web --network hoist --restart unless-stopped hoist-web:latest"
    );
  });

  it("includes env vars", () => {
    const cmd = buildDockerRunCmd("hoist-web", "img:latest", {
      NODE_ENV: "production",
      PORT: "3000",
    });
    expect(cmd).toContain("-e 'NODE_ENV=production'");
    expect(cmd).toContain("-e 'PORT=3000'");
  });

  it("escapes single quotes in env values", () => {
    const cmd = buildDockerRunCmd("hoist-web", "img:latest", {
      MSG: "it's alive",
    });
    expect(cmd).toContain("-e 'MSG=it'\\''s alive'");
  });

  it("handles empty env", () => {
    const cmd = buildDockerRunCmd("c", "i", {});
    expect(cmd).not.toContain("-e");
  });

  it("puts image at the end", () => {
    const cmd = buildDockerRunCmd("c", "myimage:v1", { A: "1" });
    expect(cmd).toMatch(/myimage:v1$/);
  });

  it("preserves env var order", () => {
    const cmd = buildDockerRunCmd("c", "i", { Z: "1", A: "2" });
    const zIdx = cmd.indexOf("Z=1");
    const aIdx = cmd.indexOf("A=2");
    expect(zIdx).toBeLessThan(aIdx);
  });
});
