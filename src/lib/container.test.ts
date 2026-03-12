import { describe, it, expect } from "vitest";

import { containerName, imageName, buildDockerRunCmd } from "./container.js";

describe("containerName", () => {
  it("returns service name as-is", () => {
    expect(containerName("web")).toBe("web");
    expect(containerName("api-server")).toBe("api-server");
  });
});

describe("imageName", () => {
  it("returns service name as-is", () => {
    expect(imageName("web")).toBe("web");
  });
});

describe("buildDockerRunCmd", () => {
  it("builds basic run command", () => {
    const cmd = buildDockerRunCmd("web", "web:latest", {});
    expect(cmd).toBe(
      "docker run -d --name web --network hoist --restart unless-stopped web:latest"
    );
  });

  it("includes env vars", () => {
    const cmd = buildDockerRunCmd("web", "img:latest", {
      NODE_ENV: "production",
      PORT: "3000",
    });
    expect(cmd).toContain("-e 'NODE_ENV=production'");
    expect(cmd).toContain("-e 'PORT=3000'");
  });

  it("escapes single quotes in env values", () => {
    const cmd = buildDockerRunCmd("web", "img:latest", {
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
