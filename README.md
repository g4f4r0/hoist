<p align="center">
  <h1 align="center">Hoist</h1>
</p>

<p align="center">
  <strong>Tell your AI agent to deploy. It handles the rest.</strong><br />
  Open-source CLI that turns any AI coding agent into a full infrastructure team.
</p>

<p align="center">
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="MIT License" /></a>
  <a href="https://www.npmjs.com/package/hoist-cli"><img src="https://img.shields.io/npm/v/hoist-cli.svg" alt="npm version" /></a>
  <a href="https://www.npmjs.com/package/hoist-cli"><img src="https://img.shields.io/npm/dm/hoist-cli.svg" alt="npm downloads" /></a>
</p>

<p align="center">
  <a href="#quick-start">Quick start</a> ·
  <a href="#how-it-works">How it works</a> ·
  <a href="#features">Features</a> ·
  <a href="#architecture">Architecture</a> ·
  <a href="#cli-reference">CLI reference</a>
</p>

---

Most deployment tools give you a dashboard. Hoist gives your AI agent a CLI — so you can go from code to production in one conversation instead of clicking through three different consoles.

```
You:    Deploy this Node.js API with Postgres on a cheap server.

Agent:  Done. Here's what I set up:
        ✓ Server "prod" (2 vCPU, 4GB) running at 1.2.3.4 — €3.49/mo
        ✓ App deployed at port 3000
        ✓ Postgres 16 with DATABASE_URL injected
        ✓ SSL certificate active for api.myapp.com
```

No DevOps hire. No infrastructure rabbit holes. No $50/month platform tax. Just your agent, your cloud account, and servers you own.

Works with Claude Code, Codex, Cursor, Windsurf, Copilot — anything that can run shell commands.

```
npm install -g hoist-cli
```

---

## Quick start

```bash
# 1. Install and configure a cloud provider
npm install -g hoist-cli
hoist init

# 2. Create a server (~60 seconds)
hoist server create --name prod --type cx22 --region fsn1

# 3. Deploy your app
hoist deploy --service api

# 4. Add a database
hoist template create --name db --type postgres --version 16

# 5. Point your domain (auto-SSL included)
hoist domain add api.myapp.com --service api
```

Every command returns `--json` for agents. Your agent reads the output, handles errors, and moves to the next step.

---

## How it works

```
You ←→ AI agent ←→ Hoist CLI ←→ Cloud provider APIs ←→ Your servers (via SSH)
```

Hoist installs a skill file that teaches your agent how to manage infrastructure. The agent asks clarifying questions, runs CLI commands, reads structured JSON output, and handles the full deployment lifecycle without you touching a terminal.

Behind the conversation above, the agent ran:

```bash
hoist server create --name prod --type cx22 --region fsn1 --json --yes
hoist deploy --service api --json --yes
hoist template create --name db --type postgres --version 16 --json --yes
hoist env set api DATABASE_URL="postgresql://..." --json
hoist domain add api.myapp.com --service api --json
```

---

## Features

- **Zero-downtime deploys** from any Dockerfile, with automatic rollback on failure
- **One-command databases** — Postgres, MySQL, Redis, MongoDB via built-in templates
- **Auto-SSL** via Let's Encrypt through Caddy reverse proxy
- **Multi-provider** — mix Hetzner, Vultr, and DigitalOcean in a single project
- **Health checks** — endpoint monitoring, container health, disk/CPU/RAM alerts
- **Per-service env vars** with runtime injection and masked output
- **Agent-native** — auto-generates skill files for Claude Code, Codex, and others
- **Stateless** — no local database, servers are the source of truth
- **No vendor lock-in** — standard Docker containers, switch providers anytime
- **No Kubernetes** — plain Docker on affordable VPS instances

---

## Providers

| Provider | Status |
|----------|--------|
| Hetzner Cloud | Supported |
| Vultr | Supported |
| DigitalOcean | Supported |

Add your own or contribute support for a new provider.

---

## Architecture

### On your machine

```
~/.hoist/
├── config.json          # Provider API keys, defaults
└── keys/
    ├── hoist_rsa         # SSH private key (auto-generated)
    └── hoist_rsa.pub     # Uploaded to every server
```

### In your project

```
my-project/
├── hoist.json            # Declarative config (committed to git)
├── .env.production       # Secrets (gitignored)
└── Dockerfile            # Build instructions
```

### On each server

```
Server (VPS)
├── Docker Engine          # Container runtime
├── Caddy (container)      # Reverse proxy + auto-SSL
├── App containers         # Your applications
├── Service containers     # Postgres, Redis, etc.
├── Docker volumes         # Persistent data
└── UFW firewall           # Ports 22, 80, 443 only
```

Everything runs in Docker. Containers talk over an internal network. Databases are never exposed to the internet.

---

## Project config

`hoist.json` is the declarative desired state of your infrastructure. Committed to git. No secrets.

```json
{
  "project": "my-saas",
  "servers": {
    "prod": { "provider": "hetzner-1" }
  },
  "services": {
    "api": {
      "server": "prod",
      "type": "app",
      "source": ".",
      "port": 3000,
      "domain": "api.myapp.com"
    },
    "db": {
      "server": "prod",
      "type": "postgres",
      "version": "16"
    }
  }
}
```

---

## CLI reference

```bash
hoist init                          # Set up Hoist + add a cloud provider
hoist server create|import|list|status|destroy|ssh
hoist deploy [--service <name>]     # Build and deploy from Dockerfile
hoist rollback --service <name>     # Instant rollback
hoist template create|list|info|inspect|backup|destroy|start|stop|restart
hoist domain add|list|delete        # Custom domains + auto-SSL
hoist env set|get|list|delete|import|export
hoist logs <service> [--follow]     # Container logs
hoist status                        # Full project overview
hoist doctor                        # Health check everything
hoist provider add|list|test|set-default|delete
hoist keys show|rotate
hoist update                        # Update agent skills + check for CLI updates
hoist skill export                  # Package skills for publishing
```

All commands support `--json`. Mutating commands support `--yes` to skip confirmations.

---

## Agent integration

Hoist auto-generates skill files so AI agents understand your infrastructure out of the box:

| Agent | Location |
|-------|----------|
| Claude Code | `~/.claude/skills/hoist/` |
| Codex | `~/.agents/skills/hoist/` |

Each skill includes `SKILL.md` (how to use Hoist), `COMMANDS.md` (full flag reference), and `DOCKERFILES.md` (framework-specific Docker patterns for Next.js, Remix, Astro, Python, Go, Rust, and more).

Run `hoist init` or `hoist update` to generate. Hoist never modifies your CLAUDE.md or AGENTS.md.

---

## Security

Hoist is designed so your AI agent can manage infrastructure without ever seeing your secrets.

- **API keys stay on your machine** — stored with `600` permissions, never sent to agents or logged in output
- **Agents never handle credentials directly** — setup commands (`hoist init`, `provider add`) are interactive and human-only; the skill file explicitly tells agents not to run them
- **`--json` mode is non-interactive** — agents can't get stuck on confirmation prompts; missing required args return errors, not input prompts
- **SSH key-only auth** — password login disabled on all managed servers
- **UFW firewall** — only ports 22, 80, 443 open
- **Network isolation** — databases and services talk over an internal Docker network, never exposed to the internet
- **Caddy reverse proxy** — containers are only reachable through Caddy, never bound to public ports directly
- **No secrets in git** — env vars injected at runtime, `env list` masks values by default

---

## Contributing

```bash
git clone https://github.com/g4f4r0/hoist.git
cd hoist
npm install
npm run build
npm link          # Test locally as `hoist`
npm test          # Run tests
```

---

## License

[MIT](LICENSE)
