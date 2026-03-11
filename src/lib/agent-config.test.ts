import fs from "node:fs";
import path from "node:path";
import os from "node:os";

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { writeAgentConfig } from "./agent-config.js";

let origHome: string;
let tmpHome: string;

beforeEach(() => {
  origHome = os.homedir();
  tmpHome = fs.mkdtempSync(path.join("/tmp", "hoist-test-home-"));
  vi.spyOn(os, "homedir").mockReturnValue(tmpHome);
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

describe("writeAgentConfig", () => {
  it("creates Claude skill files in ~/.claude/skills/hoist/", () => {
    const written = writeAgentConfig();
    expect(written).toContain("~/.claude/skills/hoist/SKILL.md");
    expect(written).toContain("~/.claude/skills/hoist/COMMANDS.md");
    expect(fs.existsSync(path.join(tmpHome, ".claude", "skills", "hoist", "SKILL.md"))).toBe(true);
    expect(fs.existsSync(path.join(tmpHome, ".claude", "skills", "hoist", "COMMANDS.md"))).toBe(true);
  });

  it("creates Codex skill files in ~/.agents/skills/hoist/", () => {
    const written = writeAgentConfig();
    expect(written).toContain("~/.agents/skills/hoist/SKILL.md");
    expect(written).toContain("~/.agents/skills/hoist/COMMANDS.md");
    expect(fs.existsSync(path.join(tmpHome, ".agents", "skills", "hoist", "SKILL.md"))).toBe(true);
    expect(fs.existsSync(path.join(tmpHome, ".agents", "skills", "hoist", "COMMANDS.md"))).toBe(true);
  });

  it("generates valid Claude skill with frontmatter", () => {
    writeAgentConfig();
    const content = fs.readFileSync(
      path.join(tmpHome, ".claude", "skills", "hoist", "SKILL.md"),
      "utf-8"
    );
    expect(content).toMatch(/^---\n/);
    expect(content).toContain("name: managing-infrastructure");
    expect(content).toContain("description:");
  });

  it("generates valid Codex skill with frontmatter", () => {
    writeAgentConfig();
    const content = fs.readFileSync(
      path.join(tmpHome, ".agents", "skills", "hoist", "SKILL.md"),
      "utf-8"
    );
    expect(content).toMatch(/^---\n/);
    expect(content).toContain("name: managing-infrastructure");
    expect(content).toContain("description:");
  });

  it("COMMANDS.md has full command reference", () => {
    writeAgentConfig();
    const content = fs.readFileSync(
      path.join(tmpHome, ".claude", "skills", "hoist", "COMMANDS.md"),
      "utf-8"
    );
    expect(content).toContain("hoist server create");
    expect(content).toContain("hoist deploy");
    expect(content).toContain("hoist template");
    expect(content).toContain("hoist domain");
    expect(content).toContain("hoist env");
  });

  it("SKILL.md references COMMANDS.md for progressive disclosure", () => {
    writeAgentConfig();
    const content = fs.readFileSync(
      path.join(tmpHome, ".claude", "skills", "hoist", "SKILL.md"),
      "utf-8"
    );
    expect(content).toContain("COMMANDS.md");
  });

  it("includes human-in-the-loop warning", () => {
    writeAgentConfig();
    const content = fs.readFileSync(
      path.join(tmpHome, ".claude", "skills", "hoist", "SKILL.md"),
      "utf-8"
    );
    expect(content).toContain("NEVER run these commands");
    expect(content).toContain("hoist init");
    expect(content).toContain("hoist provider add");
  });

  it("includes decision tree", () => {
    writeAgentConfig();
    const content = fs.readFileSync(
      path.join(tmpHome, ".claude", "skills", "hoist", "SKILL.md"),
      "utf-8"
    );
    expect(content).toContain("Decision Tree");
    expect(content).toContain("hoist.json");
  });

  it("tells agent to read hoist.json for project context", () => {
    writeAgentConfig();
    const content = fs.readFileSync(
      path.join(tmpHome, ".claude", "skills", "hoist", "SKILL.md"),
      "utf-8"
    );
    expect(content).toContain("Read `hoist.json`");
  });
});
