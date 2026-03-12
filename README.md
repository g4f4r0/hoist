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

A VPS costs a few bucks a month. The hard part is everything else — SSH, Docker, firewalls, SSL certs, database backups, zero-downtime deploys. That's where your time goes.

You're already building in chat. Why leave to click through a dashboard?

```
You:    Deploy this Node.js API with Postgres on a cheap server.

Agent:  Done. Here's what I set up:
        ✓ Server "prod" (2 vCPU, 4GB) running at 1.2.3.4 — €3.49/mo
        ✓ App deployed at port 3000
        ✓ Postgres 16 with DATABASE_URL injected
        ✓ SSL certificate active for api.myapp.com
```

No DevOps hire. No infrastructure rabbit holes. No $50/month platform tax. Just your agent, your cloud account, and servers you own.

Works with Claude Code, Codex, Cursor, Gemini CLI, Windsurf, Copilot — anything that can run shell commands.

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
hoist server create

# 3. Deploy your app
hoist deploy

# 4. Add a database
hoist deploy --template postgres --server prod

# 5. Point your domain (auto-SSL included)
hoist domain add api.myapp.com
```

Your agent runs commands, reads structured JSON, and handles the full lifecycle autonomously.

---

## How it works

```
You ←→ AI agent ←→ Hoist CLI ←→ Cloud provider APIs ←→ Your servers (via SSH)
```

Hoist installs a skill file that teaches your agent how to manage infrastructure. The agent asks clarifying questions, runs CLI commands, reads structured JSON output, and handles the full deployment lifecycle without you touching a terminal.

Behind the conversation above, the agent ran:

```bash
hoist server create --name prod --type cx22 --region fsn1
hoist deploy
hoist deploy --template postgres --server prod
hoist env set api DATABASE_URL="postgresql://..."
hoist domain add api.myapp.com
```

---

## Features

- **Zero-downtime deploys** from any Dockerfile, with automatic rollback on failure
- **One-command databases** — Postgres, MySQL, MariaDB, Redis, MongoDB via built-in templates
- **Auto-SSL** via Let's Encrypt through Traefik reverse proxy
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
| Hostinger | Supported |
| Linode | Supported |
| Scaleway | Supported |
| AWS, GCP, ... | Coming soon |

Started with VPS because it's the best value. Cloud platforms are next — same chat-based workflow, more deployment targets. More templates (queues, caches, search) are coming too.

Contributions welcome.

---

## Architecture

### On your machine

```
~/.hoist/
├── config.json          # Provider API keys, defaults
└── keys/
    ├── hoist_ed25519     # SSH private key (auto-generated)
    └── hoist_ed25519.pub # Uploaded to every server
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
├── Traefik (container)     # Reverse proxy + auto-SSL
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
hoist server create|import|list|status|regions|types|stats|destroy|ssh
hoist deploy [--service <name>]     # Build and deploy from Dockerfile
hoist rollback --service <name>     # Instant rollback
hoist deploy --template <type> --server <s>  # Deploy a database template
hoist template list|info|inspect|services|backup|destroy|start|stop|restart|public|private
hoist domain add|list|delete        # Custom domains + auto-SSL
hoist env set|get|list|delete|import|export
hoist logs <service> [--follow]     # Container logs
hoist status                        # Full project overview
hoist doctor                        # Health check everything
hoist provider add|list|test|update|set-default|delete
hoist keys show|rotate
hoist config validate                # Validate hoist.json
```

Update: `npm install -g hoist-cli@latest`

---

## Agent integration

Hoist implements the [Agent Skills](https://agentskills.io) open standard. After `hoist init`, skill files are installed globally and auto-discovered by any compatible agent:

| Agent | Location |
|-------|----------|
| Claude Code | `~/.claude/skills/hoist/` |
| Cursor | `~/.cursor/skills/hoist/` |
| Gemini CLI | `~/.gemini/skills/hoist/` |
| OpenCode | `~/.config/opencode/skills/hoist/` |
| Codex | `~/.agents/skills/hoist/` |

Each skill includes `SKILL.md` (how to use Hoist), `COMMANDS.md` (full command reference), and `DOCKERFILES.md` (framework-specific Docker patterns for Next.js, Remix, Astro, Python, Go, Rust, and more).

Any agent that supports the Agent Skills standard will pick up Hoist automatically — no manual configuration needed.

---

## AI-native design

Hoist is built for AI agents, not humans. Traditional CLIs need flags like `--json` or `--yes` to work with automation. Hoist detects it's being called by an agent (non-TTY) and adapts automatically:

- **Structured JSON** on stdout, no spinners or color
- **No interactive prompts** — missing args return errors, not input requests
- **Smart defaults** — random server names, cheapest instance type, auto-selects the only service
- **Skill files** — teach your agent the full deployment workflow, what to confirm, and how to recover from errors
- **Humans welcome too** — in a terminal, Hoist shows interactive prompts, spinners, and color

## Security

Hoist is designed so your AI agent can manage infrastructure without ever seeing your secrets.

- **API keys stay on your machine** — stored with `600` permissions, never sent to agents or logged in output
- **Agents never handle credentials directly** — setup commands (`hoist init`, `provider add`) are interactive and human-only
- **SSH key-only auth** — password login disabled on all managed servers
- **UFW firewall** — only ports 22, 80, 443 open
- **Network isolation** — databases and services talk over an internal Docker network, never exposed to the internet
- **Traefik reverse proxy** — containers are only reachable through Traefik, never bound to public ports directly
- **No secrets in git** — env vars injected at runtime, `env list` masks values in human mode

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
