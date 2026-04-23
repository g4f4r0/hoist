import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { writeAgentConfig, writePublishedSkillBundle } from "./agent-config.js";

let tmpHome: string;

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join("/tmp", "hoist-test-home-"));
  vi.spyOn(os, "homedir").mockReturnValue(tmpHome);
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

describe("writeAgentConfig", () => {
  it("creates Claude skill files in ~/.claude/skills/hoist", () => {
    const written = writeAgentConfig();

    expect(written).toContain("~/.claude/skills/hoist/SKILL.md");
    expect(written).toContain("~/.claude/skills/hoist/COMMANDS.md");
    expect(fs.existsSync(path.join(tmpHome, ".claude", "skills", "hoist", "SKILL.md"))).toBe(true);
    expect(fs.existsSync(path.join(tmpHome, ".claude", "skills", "hoist", "COMMANDS.md"))).toBe(true);
  });

  it("creates Codex skill files in ~/.agents/skills/hoist", () => {
    const written = writeAgentConfig();

    expect(written).toContain("~/.agents/skills/hoist/SKILL.md");
    expect(written).toContain("~/.agents/skills/hoist/COMMANDS.md");
    expect(fs.existsSync(path.join(tmpHome, ".agents", "skills", "hoist", "SKILL.md"))).toBe(true);
    expect(fs.existsSync(path.join(tmpHome, ".agents", "skills", "hoist", "COMMANDS.md"))).toBe(true);
  });

  it("creates OpenClaw workspace skill files in ~/.openclaw/workspace/skills/hoist", () => {
    const written = writeAgentConfig();

    expect(written).toContain("~/.openclaw/workspace/skills/hoist/SKILL.md");
    expect(written).toContain("~/.openclaw/workspace/skills/hoist/COMMANDS.md");
    expect(fs.existsSync(path.join(tmpHome, ".openclaw", "workspace", "skills", "hoist", "SKILL.md"))).toBe(true);
    expect(fs.existsSync(path.join(tmpHome, ".openclaw", "workspace", "skills", "hoist", "COMMANDS.md"))).toBe(true);
  });

  it("generates valid skill frontmatter", () => {
    writeAgentConfig();

    const content = fs.readFileSync(
      path.join(tmpHome, ".agents", "skills", "hoist", "SKILL.md"),
      "utf-8"
    );

    expect(content).toMatch(/^---\n/);
    expect(content).toContain("name: hoist");
    expect(content).toContain("description:");
    expect(content).toContain("homepage: https://github.com/g4f4r0/hoist");
  });

  it("includes OpenClaw binary requirements and npm install metadata", () => {
    writeAgentConfig();

    const content = fs.readFileSync(
      path.join(tmpHome, ".agents", "skills", "hoist", "SKILL.md"),
      "utf-8"
    );

    expect(content).toContain("\"skillKey\":\"hoist\"");
    expect(content).toContain("\"requires\":{\"bins\":[\"hoist\"]}");
    expect(content).toContain("\"kind\":\"node\"");
    expect(content).toContain("\"package\":\"hoist-cli\"");
  });

  it("references COMMANDS.md for progressive disclosure", () => {
    writeAgentConfig();

    const content = fs.readFileSync(
      path.join(tmpHome, ".claude", "skills", "hoist", "SKILL.md"),
      "utf-8"
    );

    expect(content).toContain("COMMANDS.md");
  });

  it("includes human-in-the-loop guidance", () => {
    writeAgentConfig();

    const content = fs.readFileSync(
      path.join(tmpHome, ".claude", "skills", "hoist", "SKILL.md"),
      "utf-8"
    );

    expect(content).toContain("Sensitive Operations");
    expect(content).toContain("hoist init");
    expect(content).toContain("hoist provider add");
  });

  it("includes the decision tree and hoist.json guidance", () => {
    writeAgentConfig();

    const content = fs.readFileSync(
      path.join(tmpHome, ".claude", "skills", "hoist", "SKILL.md"),
      "utf-8"
    );

    expect(content).toContain("Decision Tree");
    expect(content).toContain("hoist.json");
  });
});

describe("writePublishedSkillBundle", () => {
  it("writes a publishable bundle with all skill files", () => {
    const targetDir = path.join(tmpHome, "skills", "hoist");
    const written = writePublishedSkillBundle(targetDir);

    expect(written).toEqual([
      path.join(targetDir, "SKILL.md"),
      path.join(targetDir, "COMMANDS.md"),
      path.join(targetDir, "DOCKERFILES.md"),
    ]);
    expect(fs.existsSync(path.join(targetDir, "SKILL.md"))).toBe(true);
    expect(fs.existsSync(path.join(targetDir, "COMMANDS.md"))).toBe(true);
    expect(fs.existsSync(path.join(targetDir, "DOCKERFILES.md"))).toBe(true);
  });
});
