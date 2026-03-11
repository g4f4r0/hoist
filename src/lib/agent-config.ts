import fs from "node:fs";
import path from "node:path";
import os from "node:os";

import { DOCKERFILES_MD } from "./dockerfiles-reference.js";

export function generateSkillContent(): string {
  // Strip Claude-specific frontmatter, return just the body
  return generateClaudeSkill().replace(/^---[\s\S]*?---\n\n/, "");
}

export { generateCommandsReference };

function generateClaudeSkill(): string {
  return [
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
    "| `hoist keys rotate` | Confirm key rotation on all servers (supports `--yes`) |",
    "",
    "Tell the user exactly what to run and what to expect.",
    "",
    "---",
    "",
    "## Commands",
    "",
    "For full command reference with all flags, see [COMMANDS.md](COMMANDS.md).",
    "",
    "**Providers:** `provider list`, `provider test`, `provider set-default`, `provider delete`",
    "",
    "**Servers:** `server create`, `server import`, `server list`, `server status <name>`, `server ssh <name>`, `server destroy <name>`",
    "",
    "**Deploy:** `deploy`, `deploy --service <name>`, `deploy --repo <url> --branch <branch>`, `rollback --service <name>`",
    "",
    "**Templates:** `template list`, `template info <name>`, `template create --type <type>`, `template services`, `template inspect <name>`, `template backup <name>`, `template destroy <name>`, `template stop/start/restart <name>`",
    "",
    "**Domains:** `domain add <domain> --service <name>`, `domain list`, `domain delete <domain>`",
    "",
    "**Env vars:** `env set <service> KEY=VAL`, `env get <service> <key>`, `env list <service>`, `env delete <service> <key>`, `env import <service> <file>`, `env export <service>`",
    "",
    "**Monitoring:** `logs <service>`, `logs <service> --follow`, `status`, `doctor`",
    "",
    "**Other:** `keys show`, `keys rotate --yes`, `config validate`, `update`, `skill export`, `--status` (quick overview)",
    "",
    "All commands support `--json` (except `server ssh` which opens an interactive terminal). Destructive/mutating commands also support `--yes` to skip confirmations.",
    "",
    "---",
    "",
    "## Project Config",
    "",
    "Read `hoist.json` in the project root for current project context (servers, services, domains).",
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
    "## Interactive Deployment Procedure",
    "",
    "Ask the user for each parameter before proceeding:",
    "",
    "1. **Server** — Which server? If none exist, ask: provider, region, type, name",
    "2. **Service** — App (needs Dockerfile + port) or database (pick type + version)? If no Dockerfile exists, generate one — see [DOCKERFILES.md](DOCKERFILES.md) for framework-specific examples.",
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
    "1. Always use `--json`; add `--yes` on commands that modify state (deploy, destroy, create, rollback)",
    "2. Never handle API keys — tell user to run setup commands",
    "3. Parse stdout for JSON, check exit code (0 = ok, 1 = error)",
    "4. Run `hoist doctor --json` to diagnose any issue",
    "5. Server names in hoist.json must match what was used during creation",
    "",
  ].join("\n");
}

function generateCommandsReference(): string {
  return [
    "# Hoist CLI — Full Command Reference",
    "",
    "## Providers",
    "",
    "```bash",
    "hoist provider list --json",
    "hoist provider test [label] --json",
    "hoist provider set-default [label] --json",
    "hoist provider delete [label] --json --yes",
    "```",
    "",
    "## Servers",
    "",
    "```bash",
    "hoist server create --name <n> --provider <p> --type <t> --region <r> --json --yes",
    "hoist server import --name <n> --ip <ip> [--user <user>] --json --yes",
    "hoist server list [--provider <p>] --json",
    "hoist server status <name> [--provider <p>] --json",
    "hoist server ssh <name> [--provider <p>]",
    "hoist server destroy <name> [--provider <p>] --json --yes",
    "```",
    "",
    "## Deploy & Rollback",
    "",
    "```bash",
    "hoist deploy --json --yes                              # From Dockerfile in current dir",
    "hoist deploy --service <name> --json --yes              # Deploy a specific service",
    "hoist deploy --repo <url> [--branch <branch>] --json --yes  # From Git repo",
    "hoist rollback --service <name> [--server <s>] --json --yes",
    "```",
    "",
    "## Templates (Databases & Services)",
    "",
    "```bash",
    "hoist template list --json",
    "hoist template info <name> --json",
    "hoist template create --name <n> --type <type> [--version <v>] --server <s> --json --yes",
    "hoist template services [--server <s>] --json",
    "hoist template inspect <name> [--server <s>] --json",
    "hoist template backup <name> [--server <s>] [--output <path>] --json",
    "hoist template destroy <name> [--server <s>] [--delete-volumes] --json --yes",
    "hoist template stop <name> [--server <s>] --json",
    "hoist template start <name> [--server <s>] --json",
    "hoist template restart <name> [--server <s>] --json",
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
    "hoist env set <service> KEY=VAL KEY2=VAL2 [--server <s>] --json",
    "hoist env get <service> <key> [--server <s>] --json",
    "hoist env list <service> [--server <s>] [--show-values] --json",
    "hoist env delete <service> <key> [--server <s>] --json",
    "hoist env import <service> .env [--server <s>] --json",
    "hoist env export <service> [--server <s>] --json",
    "```",
    "",
    "## Monitoring & Health",
    "",
    "```bash",
    "hoist logs <service> [--server <s>] --lines 100 --json",
    "hoist logs <service> --follow --json",
    "hoist status --json",
    "hoist doctor --json",
    "```",
    "",
    "## SSH Keys & Config",
    "",
    "```bash",
    "hoist keys show --json",
    "hoist keys rotate --json --yes",
    "hoist config validate --json",
    "```",
    "",
    "## Update",
    "",
    "```bash",
    "hoist update --json                # Update agent skill files + check for CLI updates",
    "hoist --status                     # Quick overview: version, auth, providers",
    "```",
    "",
    "## Skill Export",
    "",
    "```bash",
    "hoist skill export --skill-version <version> [--name <name>] [-o <dir>] --json",
    "```",
    "",
  ].join("\n");
}

export function generateDockerfileReference(): string {
  return DOCKERFILES_MD;
}

function generateCodexSkill(): string {
  const lines: string[] = [
    "---",
    "name: managing-infrastructure",
    "description: Deploys and manages apps, servers, databases, domains, and environment variables on VPS providers using the Hoist CLI. Triggers when user mentions deploying, provisioning, databases, domains, env vars, or infrastructure health.",
    "---",
    "",
  ];

  lines.push(generateClaudeSkill().replace(/^---[\s\S]*?---\n\n/, ""));

  return lines.join("\n");
}

/** Writes skill files globally to ~/.claude/ and ~/.agents/. */
export function writeAgentConfig(): string[] {
  const home = os.homedir();
  const written: string[] = [];

  // Claude skill: ~/.claude/skills/hoist/
  const claudeSkillDir = path.join(home, ".claude", "skills", "hoist");
  fs.mkdirSync(claudeSkillDir, { recursive: true });
  fs.writeFileSync(
    path.join(claudeSkillDir, "SKILL.md"),
    generateClaudeSkill(),
    "utf-8"
  );
  fs.writeFileSync(
    path.join(claudeSkillDir, "COMMANDS.md"),
    generateCommandsReference(),
    "utf-8"
  );
  fs.writeFileSync(
    path.join(claudeSkillDir, "DOCKERFILES.md"),
    generateDockerfileReference(),
    "utf-8"
  );
  written.push("~/.claude/skills/hoist/SKILL.md");
  written.push("~/.claude/skills/hoist/COMMANDS.md");
  written.push("~/.claude/skills/hoist/DOCKERFILES.md");

  // Codex skill: ~/.agents/skills/hoist/
  const codexSkillDir = path.join(home, ".agents", "skills", "hoist");
  fs.mkdirSync(codexSkillDir, { recursive: true });
  fs.writeFileSync(
    path.join(codexSkillDir, "SKILL.md"),
    generateCodexSkill(),
    "utf-8"
  );
  fs.writeFileSync(
    path.join(codexSkillDir, "COMMANDS.md"),
    generateCommandsReference(),
    "utf-8"
  );
  fs.writeFileSync(
    path.join(codexSkillDir, "DOCKERFILES.md"),
    generateDockerfileReference(),
    "utf-8"
  );
  written.push("~/.agents/skills/hoist/SKILL.md");
  written.push("~/.agents/skills/hoist/COMMANDS.md");
  written.push("~/.agents/skills/hoist/DOCKERFILES.md");

  return written;
}
