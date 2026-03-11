import fs from "node:fs";
import path from "node:path";

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { writeAgentConfig } from "./agent-config.js";
import type { ProjectConfig } from "./project-config.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join("/tmp", "hoist-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const mockConfig: ProjectConfig = {
  project: "testapp",
  servers: {
    prod: { provider: "hetzner" },
  },
  services: {
    web: {
      server: "prod",
      type: "app" as const,
      source: ".",
      port: 3000,
      domain: "example.com",
    },
  },
};

describe("writeAgentConfig", () => {
  it("creates AGENTS.md by default", () => {
    const written = writeAgentConfig(tmpDir);
    expect(written).toContain("AGENTS.md");
    expect(fs.existsSync(path.join(tmpDir, "AGENTS.md"))).toBe(true);
  });

  it("creates Claude Code skill", () => {
    const written = writeAgentConfig(tmpDir);
    expect(written).toContain(".claude/skills/hoist/SKILL.md");
    expect(fs.existsSync(path.join(tmpDir, ".claude", "skills", "hoist", "SKILL.md"))).toBe(true);
  });

  it("creates Codex skill", () => {
    const written = writeAgentConfig(tmpDir);
    expect(written).toContain(".agents/skills/hoist/SKILL.md");
    expect(fs.existsSync(path.join(tmpDir, ".agents", "skills", "hoist", "SKILL.md"))).toBe(true);
  });

  it("prefers CLAUDE.md when it exists", () => {
    fs.writeFileSync(path.join(tmpDir, "CLAUDE.md"), "# Existing\n");
    const written = writeAgentConfig(tmpDir);
    expect(written[0]).toBe("CLAUDE.md");
  });

  it("prefers AGENTS.md when it exists", () => {
    fs.writeFileSync(path.join(tmpDir, "AGENTS.md"), "# Existing\n");
    const written = writeAgentConfig(tmpDir);
    expect(written[0]).toBe("AGENTS.md");
  });

  it("updates both when both exist", () => {
    fs.writeFileSync(path.join(tmpDir, "CLAUDE.md"), "# Claude\n");
    fs.writeFileSync(path.join(tmpDir, "AGENTS.md"), "# Agents\n");
    const written = writeAgentConfig(tmpDir);
    expect(written).toContain("CLAUDE.md");
    expect(written).toContain("AGENTS.md");
  });

  it("includes markers in generated content", () => {
    writeAgentConfig(tmpDir);
    const content = fs.readFileSync(path.join(tmpDir, "AGENTS.md"), "utf-8");
    expect(content).toContain("<!-- hoist:start -->");
    expect(content).toContain("<!-- hoist:end -->");
  });

  it("includes project info when config provided", () => {
    writeAgentConfig(tmpDir, mockConfig);
    const content = fs.readFileSync(path.join(tmpDir, "AGENTS.md"), "utf-8");
    expect(content).toContain("**prod**");
    expect(content).toContain("**web**");
    expect(content).toContain("example.com");
  });

  it("replaces content between markers on update", () => {
    writeAgentConfig(tmpDir);
    const first = fs.readFileSync(path.join(tmpDir, "AGENTS.md"), "utf-8");
    expect(first).toContain("<!-- hoist:start -->");

    writeAgentConfig(tmpDir, mockConfig);
    const second = fs.readFileSync(path.join(tmpDir, "AGENTS.md"), "utf-8");

    const startCount = (second.match(/<!-- hoist:start -->/g) ?? []).length;
    expect(startCount).toBe(1);
    expect(second).toContain("**prod**");
  });

  it("appends to existing file without markers", () => {
    fs.writeFileSync(path.join(tmpDir, "AGENTS.md"), "# My Project\n\nSome content.\n");
    writeAgentConfig(tmpDir);
    const content = fs.readFileSync(path.join(tmpDir, "AGENTS.md"), "utf-8");
    expect(content).toContain("# My Project");
    expect(content).toContain("<!-- hoist:start -->");
  });

  it("generates valid Claude skill with frontmatter", () => {
    writeAgentConfig(tmpDir);
    const content = fs.readFileSync(
      path.join(tmpDir, ".claude", "skills", "hoist", "SKILL.md"),
      "utf-8"
    );
    expect(content).toMatch(/^---\n/);
    expect(content).toContain("name: managing-infrastructure");
    expect(content).toContain("description:");
  });

  it("creates COMMANDS.md for progressive disclosure", () => {
    writeAgentConfig(tmpDir);
    const claudeCmd = path.join(tmpDir, ".claude", "skills", "hoist", "COMMANDS.md");
    const codexCmd = path.join(tmpDir, ".agents", "skills", "hoist", "COMMANDS.md");
    expect(fs.existsSync(claudeCmd)).toBe(true);
    expect(fs.existsSync(codexCmd)).toBe(true);
    const content = fs.readFileSync(claudeCmd, "utf-8");
    expect(content).toContain("hoist server create");
    expect(content).toContain("hoist deploy");
    expect(content).toContain("hoist template");
  });

  it("skill references COMMANDS.md", () => {
    writeAgentConfig(tmpDir);
    const content = fs.readFileSync(
      path.join(tmpDir, ".claude", "skills", "hoist", "SKILL.md"),
      "utf-8"
    );
    expect(content).toContain("COMMANDS.md");
  });

  it("generates valid Codex skill with frontmatter", () => {
    writeAgentConfig(tmpDir);
    const content = fs.readFileSync(
      path.join(tmpDir, ".agents", "skills", "hoist", "SKILL.md"),
      "utf-8"
    );
    expect(content).toMatch(/^---\n/);
    expect(content).toContain("name: managing-infrastructure");
    expect(content).toContain("description:");
  });
});
