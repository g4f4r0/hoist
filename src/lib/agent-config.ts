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
    "## Hoist — Infrastructure CLI",
    "",
    "Manages servers, deployments, databases, domains, and env vars on Hetzner, Vultr, DigitalOcean.",
    "Always use `--json` for structured output. Use `--yes` to skip confirmations.",
    "",
    "### Sensitive Operations — Human in the Loop",
    "",
    "**NEVER run these commands.** Tell the user to run them — they require interactive API key input:",
    "`hoist init`, `hoist provider add`, `hoist provider update`",
    "",
    "### Workflow",
    "",
    "1. Ensure user has run `hoist init`",
    "2. Create `hoist.json` with servers and services",
    "3. `hoist server create --json --yes`",
    "4. `hoist deploy --json --yes`",
    "5. `hoist status --json` to verify",
    "",
    "Parse stdout for JSON. Exit code 0 = success, 1 = error. Run `hoist doctor --json` to diagnose issues.",
  ];

  if (config) {
    lines.push("");
    lines.push("### Current Project");
    lines.push("");

    for (const name of Object.keys(config.servers)) {
      const s = config.servers[name];
      lines.push(`- Server **${name}**: provider \`${s.provider}\``);
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
    "name: managing-infrastructure",
    "description: Deploys and manages apps, servers, databases, domains, and environment variables on VPS providers (Hetzner, Vultr, DigitalOcean) using the Hoist CLI. Triggers when user mentions deploying, provisioning servers, creating databases, configuring domains, managing env vars, or checking infrastructure health.",
    "---",
    "",
    "# Hoist CLI",
    "",
    "## When to Use",
    "",
    '- "Deploy this app" -> `hoist deploy --json --yes`',
    '- "Create a server" -> `hoist server create --json --yes`',
    '- "Set up Postgres" -> `hoist template create --type postgres --json --yes`',
    '- "Add a domain" -> `hoist domain add <domain> --service <name> --json`',
    '- "What\'s running?" -> `hoist status --json`',
    '- "Check health" -> `hoist doctor --json`',
    "",
    "## When NOT to Use",
    "",
    "- **Setup commands** (`hoist init`, `hoist provider add`, `hoist provider update`) — require human API key input. Tell the user to run these.",
    "- **General coding** — Hoist is for infrastructure only.",
    "",
    "---",
    "",
    "## Decision Tree",
    "",
    "```",
    "Is hoist configured? (hoist provider list --json)",
    "+-- NO -> Tell user to run: hoist init",
    "+-- YES -> Does hoist.json exist?",
    "    +-- NO -> Create hoist.json",
    "    +-- YES -> What does the user want?",
    "        +-- New server     -> hoist server create --json --yes",
    "        +-- Import server  -> hoist server import --name X --ip Y --json --yes",
    "        +-- Deploy app     -> hoist deploy --json --yes",
    "        +-- Add database   -> hoist template create --type postgres --json --yes",
    "        +-- Add domain     -> hoist domain add <domain> --service <name> --json",
    "        +-- Set env vars   -> hoist env set <service> KEY=VAL --json",
    "        +-- Check status   -> hoist status --json",
    "        +-- Diagnose issue -> hoist doctor --json",
    "```",
    "",
    "---",
    "",
    "## Sensitive Operations — Human in the Loop",
    "",
    "**NEVER run these commands.** They prompt for API keys interactively:",
    "",
    "| Command | User action |",
    "|---------|------------|",
    "| `hoist init` | Enter provider type + API key |",
    "| `hoist provider add` | Enter provider type + API key |",
    "| `hoist provider update <label>` | Enter new API key |",
    "| `hoist keys rotate` | Confirm key rotation on all servers |",
    "",
    "Tell the user exactly what to run and what to expect.",
    "",
    "---",
    "",
    "## Commands",
    "",
    "For full command reference with all flags, see [COMMANDS.md](COMMANDS.md).",
    "",
    "**Servers:** `server create`, `server import`, `server list`, `server status <name>`, `server ssh <name>`, `server destroy <name>`",
    "",
    "**Deploy:** `deploy`, `rollback --service <name>`",
    "",
    "**Templates:** `template list`, `template create --type <type>`, `template services`, `template inspect <name>`, `template backup <name>`, `template destroy <name>`, `template stop/start/restart <name>`",
    "",
    "**Domains:** `domain add <domain> --service <name>`, `domain list`, `domain delete <domain>`",
    "",
    "**Env vars:** `env set <service> KEY=VAL`, `env get <service> <key>`, `env list <service>`, `env delete <service> <key>`, `env import <service> <file>`, `env export <service>`",
    "",
    "**Monitoring:** `logs <service>`, `status`, `doctor`",
    "",
    "**Other:** `keys show`, `config validate`",
    "",
    "All commands support `--json` and `--yes`.",
    "",
    "---",
    "",
    "## Interactive Deployment Procedure",
    "",
    "Ask the user for each parameter before proceeding:",
    "",
    "1. **Server** — Which server? If none exist, ask: provider, region, type, name",
    "2. **Service** — App (needs Dockerfile + port) or database (pick type + version)?",
    "3. **Domain** (optional) — User must point DNS A record to server IP first",
    "4. **Env vars** (optional) — DATABASE_URL, API keys, etc.",
    "",
    "---",
    "",
    "## After Deploying",
    "",
    "1. `hoist status --json` — verify deployment",
    "2. `hoist domain add <domain> --service <name> --json` — custom domain + auto-SSL",
    "3. `hoist doctor --json` — health check",
    "",
    "## After Adding a Database",
    "",
    "1. `hoist template inspect <name> --json` — get credentials",
    "2. `hoist env set <app> DATABASE_URL=<url> --json` — inject into app",
    "",
    "## After an Error",
    "",
    "1. `hoist doctor --json` — diagnose",
    "2. `hoist logs <service> --lines 200 --json` — check logs",
    "3. `hoist rollback --service <name> --json --yes` — revert bad deploy",
    "",
    "---",
    "",
    "## hoist.json",
    "",
    "Servers only need `provider`. Server specs (type, region) live on the provider, not in project config.",
    "",
    "```json",
    "{",
    '  "project": "my-app",',
    '  "servers": { "prod": { "provider": "hetzner-1" } },',
    '  "services": {',
    '    "api": { "server": "prod", "type": "app", "source": ".", "port": 3000 },',
    '    "db": { "server": "prod", "type": "postgres", "version": "16" }',
    "  }",
    "}",
    "```",
    "",
    "---",
    "",
    "## Error Reference",
    "",
    "| Error | Solution |",
    "|-------|----------|",
    '| "Run hoist init first" | Tell user to run `hoist init` |',
    '| "Provider not found" | Check `hoist provider list` for correct label |',
    '| "Server not found" | Check `hoist server list --json` |',
    '| "SSH connection failed" | Run `hoist doctor --json`, verify IP |',
    '| "No hoist.json found" | Create hoist.json in project root |',
    '| "references unknown server" | Server name in service must match servers section |',
    "",
    "---",
    "",
    "## Golden Rules",
    "",
    "1. Always use `--json` and `--yes`",
    "2. Never handle API keys — tell user to run setup commands",
    "3. Parse stdout for JSON, check exit code (0 = ok, 1 = error)",
    "4. Run `hoist doctor --json` to diagnose any issue",
    "5. Server names in hoist.json must match what was used during creation",
  ];

  if (config) {
    lines.push("");
    lines.push("---");
    lines.push("");
    lines.push("## Current Project");
    lines.push("");
    lines.push(`Project: **${config.project}**`);
    lines.push("");
    for (const [name, s] of Object.entries(config.servers)) {
      lines.push(`- Server \`${name}\`: provider \`${s.provider}\``);
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

function generateCommandsReference(): string {
  return [
    "# Hoist CLI — Full Command Reference",
    "",
    "## Servers",
    "",
    "```bash",
    "hoist server create --name <n> --provider <p> --type <t> --region <r> --json --yes",
    "hoist server import --name <n> --ip <ip> --json --yes",
    "hoist server list --json",
    "hoist server status <name> --json",
    "hoist server ssh <name>",
    "hoist server destroy <name> --json --yes",
    "```",
    "",
    "## Deploy & Rollback",
    "",
    "```bash",
    "hoist deploy --json --yes                    # From Dockerfile in current dir",
    "hoist deploy --repo <url> --json --yes       # From Git repo",
    "hoist rollback --service <name> --json --yes",
    "```",
    "",
    "## Templates (Databases & Services)",
    "",
    "```bash",
    "hoist template list --json",
    "hoist template create --name <n> --type <type> --server <s> --json --yes",
    "hoist template services --json",
    "hoist template inspect <name> --json",
    "hoist template backup <name> --json",
    "hoist template destroy <name> --json --yes",
    "hoist template stop <name> --json",
    "hoist template start <name> --json",
    "hoist template restart <name> --json",
    "```",
    "",
    "Supported types: `postgres`, `mysql`, `mariadb`, `redis`, `mongodb`",
    "",
    "## Domains & SSL",
    "",
    "```bash",
    "hoist domain add <domain> --service <name> --json   # Auto-SSL via Caddy",
    "hoist domain list --json",
    "hoist domain delete <domain> --json --yes",
    "```",
    "",
    "## Environment Variables",
    "",
    "```bash",
    "hoist env set <service> KEY=VAL KEY2=VAL2 --json",
    "hoist env get <service> <key> --json",
    "hoist env list <service> --show-values --json",
    "hoist env delete <service> <key> --json",
    "hoist env import <service> .env --json",
    "hoist env export <service> --json",
    "```",
    "",
    "## Monitoring & Health",
    "",
    "```bash",
    "hoist logs <service> --lines 100 --json",
    "hoist status --json",
    "hoist doctor --json",
    "```",
    "",
    "## SSH Keys & Config",
    "",
    "```bash",
    "hoist keys show --json",
    "hoist config validate --json",
    "```",
    "",
  ].join("\n");
}

function generateCodexSkill(config?: ProjectConfig): string {
  const lines: string[] = [
    "---",
    "name: managing-infrastructure",
    "description: Deploys and manages apps, servers, databases, domains, and environment variables on VPS providers using the Hoist CLI. Triggers when user mentions deploying, provisioning, databases, domains, env vars, or infrastructure health.",
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

  // Claude skill: SKILL.md + COMMANDS.md (progressive disclosure)
  const claudeSkillDir = path.join(dir, ".claude", "skills", "hoist");
  fs.mkdirSync(claudeSkillDir, { recursive: true });
  fs.writeFileSync(
    path.join(claudeSkillDir, "SKILL.md"),
    generateClaudeSkill(config),
    "utf-8"
  );
  fs.writeFileSync(
    path.join(claudeSkillDir, "COMMANDS.md"),
    generateCommandsReference(),
    "utf-8"
  );
  written.push(".claude/skills/hoist/SKILL.md");
  written.push(".claude/skills/hoist/COMMANDS.md");

  // Codex skill: SKILL.md + COMMANDS.md
  const codexSkillDir = path.join(dir, ".agents", "skills", "hoist");
  fs.mkdirSync(codexSkillDir, { recursive: true });
  fs.writeFileSync(
    path.join(codexSkillDir, "SKILL.md"),
    generateCodexSkill(config),
    "utf-8"
  );
  fs.writeFileSync(
    path.join(codexSkillDir, "COMMANDS.md"),
    generateCommandsReference(),
    "utf-8"
  );
  written.push(".agents/skills/hoist/SKILL.md");
  written.push(".agents/skills/hoist/COMMANDS.md");

  return written;
}
