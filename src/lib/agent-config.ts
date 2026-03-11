import fs from "node:fs";
import path from "node:path";

import { type ProjectConfig, isAppService } from "./project-config.js";

const MARKER_START = "<!-- hoist:start -->";
const MARKER_END = "<!-- hoist:end -->";

function detectTargetFile(dir: string): "CLAUDE.md" | "AGENTS.md" {
  if (fs.existsSync(path.join(dir, "CLAUDE.md"))) return "CLAUDE.md";
  if (fs.existsSync(path.join(dir, "AGENTS.md"))) return "AGENTS.md";
  if (process.env.CLAUDE_PROJECT_DIR) return "CLAUDE.md";
  return "AGENTS.md";
}

function generateInstructions(config?: ProjectConfig): string {
  const lines: string[] = [
    MARKER_START,
    "## Hoist — AI-Driven Infrastructure CLI",
    "",
    "Hoist manages servers, deployments, databases, domains, and environment variables on VPS providers (Hetzner, Vultr, DigitalOcean).",
    "Always use `--json` for structured output. Use `--yes` to skip confirmations.",
    "",
    "### Commands",
    "",
    "| Command | Description |",
    "|---------|-------------|",
    "| `hoist server create` | Provision a new VPS |",
    "| `hoist server list` | List all servers |",
    "| `hoist server destroy <name>` | Destroy a server |",
    "| `hoist deploy` | Deploy an app (local source or `--repo <url>`) |",
    "| `hoist rollback --service <name>` | Roll back to previous deployment |",
    "| `hoist template list` | List available templates |",
    "| `hoist template create` | Create a service from a template |",
    "| `hoist template services` | List running template services |",
    "| `hoist template inspect <name>` | Get service details |",
    "| `hoist template destroy <name>` | Destroy a template service |",
    "| `hoist template stop/start/restart <name>` | Control a template service |",
    "| `hoist domain add <domain> --service <name>` | Route a domain to a service |",
    "| `hoist domain list` | List domain routes |",
    "| `hoist domain delete <domain>` | Delete a domain route |",
    "| `hoist env set <service> KEY=VAL` | Set environment variables |",
    "| `hoist env get <service> <key>` | Get an environment variable |",
    "| `hoist env list <service>` | List environment variables |",
    "| `hoist env delete <service> <key>` | Delete an environment variable |",
    "| `hoist env import <service> <file>` | Import from .env file |",
    "| `hoist env export <service>` | Export env as KEY=VALUE lines |",
    "| `hoist logs <service>` | View service logs (`--follow`, `--lines`) |",
    "| `hoist status` | Show project deployment status |",
    "| `hoist doctor` | Run health checks |",
    "",
    "### Workflow",
    "",
    "1. Create `hoist.json` defining servers and services",
    "2. `hoist server create --json` to provision",
    "3. `hoist deploy --json` to deploy",
    "4. `hoist status --json` to verify",
    "",
    "All commands return structured JSON with `--json`. Parse stdout for data, check exit code for success (0) or failure (1).",
  ];

  if (config) {
    lines.push("");
    lines.push("### Current Project");
    lines.push("");

    const serverNames = Object.keys(config.servers);
    for (const name of serverNames) {
      const s = config.servers[name];
      lines.push(`- Server **${name}**: ${s.provider} ${s.type} in ${s.region}`);
    }

    for (const [name, svc] of Object.entries(config.services)) {
      if (isAppService(svc)) {
        const domain = svc.domain ? ` (${svc.domain})` : "";
        lines.push(`- App **${name}**: port ${svc.port} on ${svc.server}${domain}`);
      } else {
        lines.push(`- Database **${name}**: ${svc.type} ${svc.version} on ${svc.server}`);
      }
    }
  }

  lines.push(MARKER_END);
  return lines.join("\n");
}

function generateClaudeSkill(config?: ProjectConfig): string {
  const lines: string[] = [
    "---",
    "name: hoist",
    "description: Use Hoist CLI to manage servers, deploy apps, manage databases, and configure infrastructure. Trigger when the user asks about deploying, provisioning servers, managing databases, or infrastructure tasks.",
    "---",
    "",
    "# Hoist CLI",
    "",
    "You have access to the `hoist` CLI for infrastructure management. Always use `--json` for structured output and `--yes` to skip confirmations.",
    "",
    "## Available Commands",
    "",
    "```bash",
    "# Servers",
    "hoist server create --name <n> --provider <p> --type <t> --region <r> --json --yes",
    "hoist server list --json",
    "hoist server destroy <name> --json --yes",
    "",
    "# Deploy",
    "hoist deploy --json --yes",
    "hoist deploy --repo <url> --branch <branch> --json --yes",
    "hoist rollback --service <name> --json --yes",
    "",
    "# Templates",
    "hoist template list --json",
    "hoist template create --name <n> --type <type> --server <s> --json --yes",
    "hoist template services --json",
    "hoist template inspect <name> --json",
    "hoist template destroy <name> --json --yes",
    "hoist template stop/start/restart <name> --json",
    "",
    "# Domains",
    "hoist domain add <domain> --service <name> --json",
    "hoist domain list --json",
    "hoist domain delete <domain> --json --yes",
    "",
    "# Environment Variables",
    "hoist env set <service> KEY=VAL KEY2=VAL2 --json",
    "hoist env get <service> <key> --json",
    "hoist env list <service> --show-values --json",
    "hoist env delete <service> <key> --json",
    "hoist env import <service> .env --json",
    "hoist env export <service> --json",
    "",
    "# Monitoring",
    "hoist logs <service> --lines 100 --json",
    "hoist status --json",
    "hoist doctor --json",
    "```",
    "",
    "## Important",
    "",
    "- All commands support `--json` for structured output — always use it",
    "- Check exit code: 0 = success, 1 = error",
    "- Parse stdout for JSON data, stderr has human-readable messages",
    "- The project must have a `hoist.json` file defining servers and services",
    "- Run `hoist doctor --json` to diagnose issues",
  ];

  if (config) {
    lines.push("");
    lines.push("## Current Project");
    lines.push("");
    lines.push(`Project: ${config.project}`);
    lines.push("");
    for (const [name, s] of Object.entries(config.servers)) {
      lines.push(`- Server \`${name}\`: ${s.provider} ${s.type} in ${s.region}`);
    }
    for (const [name, svc] of Object.entries(config.services)) {
      if (isAppService(svc)) {
        const domain = svc.domain ? ` → ${svc.domain}` : "";
        lines.push(`- App \`${name}\`: port ${svc.port} on ${svc.server}${domain}`);
      } else {
        lines.push(`- DB \`${name}\`: ${svc.type} ${svc.version} on ${svc.server}`);
      }
    }
  }

  lines.push("");
  return lines.join("\n");
}

function generateCodexSkill(config?: ProjectConfig): string {
  const lines: string[] = [
    "---",
    "name: hoist",
    "description: Use when the user asks about deploying apps, provisioning servers, managing databases, configuring domains, or any infrastructure task. Do not use for general coding questions unrelated to deployment or infrastructure.",
    "---",
    "",
  ];

  lines.push(generateClaudeSkill(config).replace(/^---[\s\S]*?---\n\n/, ""));

  return lines.join("\n");
}

function upsertMarkerContent(filePath: string, content: string): void {
  if (fs.existsSync(filePath)) {
    const existing = fs.readFileSync(filePath, "utf-8");
    const startIdx = existing.indexOf(MARKER_START);
    const endIdx = existing.indexOf(MARKER_END);

    if (startIdx !== -1 && endIdx !== -1) {
      const before = existing.slice(0, startIdx);
      const after = existing.slice(endIdx + MARKER_END.length);
      fs.writeFileSync(filePath, before + content + after, "utf-8");
    } else {
      const separator = existing.endsWith("\n") ? "\n" : "\n\n";
      fs.writeFileSync(filePath, existing + separator + content + "\n", "utf-8");
    }
  } else {
    fs.writeFileSync(filePath, content + "\n", "utf-8");
  }
}

/** Writes agent configuration files for AI coding tools. */
export function writeAgentConfig(dir: string, config?: ProjectConfig): string[] {
  const written: string[] = [];
  const instructions = generateInstructions(config);

  const targetFile = detectTargetFile(dir);
  const targetPath = path.join(dir, targetFile);
  upsertMarkerContent(targetPath, instructions);
  written.push(targetFile);

  if (targetFile === "AGENTS.md" && fs.existsSync(path.join(dir, "CLAUDE.md"))) {
    upsertMarkerContent(path.join(dir, "CLAUDE.md"), instructions);
    written.push("CLAUDE.md");
  } else if (targetFile === "CLAUDE.md" && fs.existsSync(path.join(dir, "AGENTS.md"))) {
    upsertMarkerContent(path.join(dir, "AGENTS.md"), instructions);
    written.push("AGENTS.md");
  }

  const claudeSkillDir = path.join(dir, ".claude", "skills", "hoist");
  fs.mkdirSync(claudeSkillDir, { recursive: true });
  fs.writeFileSync(
    path.join(claudeSkillDir, "SKILL.md"),
    generateClaudeSkill(config),
    "utf-8"
  );
  written.push(".claude/skills/hoist/SKILL.md");

  const codexSkillDir = path.join(dir, ".agents", "skills", "hoist");
  fs.mkdirSync(codexSkillDir, { recursive: true });
  fs.writeFileSync(
    path.join(codexSkillDir, "SKILL.md"),
    generateCodexSkill(config),
    "utf-8"
  );
  written.push(".agents/skills/hoist/SKILL.md");

  return written;
}
