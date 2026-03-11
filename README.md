<p align="center">
  <h1 align="center">Hoist</h1>
</p>

<p align="center">
  <strong>Your AI agent's infrastructure toolkit.</strong><br />
  Provision servers, deploy apps, manage databases, and configure domains — all through your AI coding agent.
</p>

<p align="center">
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="MIT License" /></a>
  <a href="https://www.npmjs.com/package/hoist-cli"><img src="https://img.shields.io/npm/v/hoist-cli.svg" alt="npm version" /></a>
  <a href="https://www.npmjs.com/package/hoist-cli"><img src="https://img.shields.io/npm/dm/hoist-cli.svg" alt="npm downloads" /></a>
  <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg" alt="Node.js" /></a>
</p>

<p align="center">
  <a href="#quick-start">Quick Start</a> ·
  <a href="#how-it-works">How It Works</a> ·
  <a href="#features">Features</a> ·
  <a href="#providers">Providers</a> ·
  <a href="#architecture">Architecture</a> ·
  <a href="#cli-reference">CLI Reference</a>
</p>

---

## Why Hoist?

Most deployment tools give you a dashboard. Hoist gives your AI agent a CLI.

- **No dashboard.** Your agent is the UI.
- **No hosted service.** We run nothing. You own everything.
- **No local state.** Servers are the source of truth.
- **No vendor lock-in.** Standard Docker containers. Switch providers anytime.
- **No Kubernetes.** Plain Docker on affordable VPS instances.

Hoist is an open-source CLI that turns any AI coding agent into an infrastructure expert. It works with Claude Code, Codex, Cursor, Windsurf, Copilot, and any agent that can run shell commands.

```
npm install -g hoist-cli
```

---

## Quick Start

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

# 5. Point your domain
hoist domain add api.myapp.com --service api
```

Every command supports `--json` output for agents.

---

## How It Works

```
You ←→ AI Agent ←→ Hoist CLI ←→ Cloud Provider APIs (Hetzner, Vultr, DigitalOcean)
                              ←→ Your Servers (via SSH)
```

You tell your agent what you want. The agent reads Hoist's skill file, asks clarifying questions, and runs CLI commands. Every command returns structured JSON. The agent reads the output, handles errors, and moves to the next step.

```
You:    I want to deploy this Node.js API with Postgres.

Agent:  I see you have Hoist configured with Hetzner.
        A CX22 (2 vCPU, 4GB RAM) in Falkenstein costs €3.49/mo.
        Want me to set it up?

You:    Yes.

Agent:  Done. Here's what I set up:
        ✓ Server "prod" running at 1.2.3.4
        ✓ App deployed at port 3000
        ✓ Postgres 16 with DATABASE_URL injected
        ✓ SSL certificate active for api.myapp.com

        Point your DNS A record to 1.2.3.4 and you're live.
```

Behind the scenes, the agent executed:

```bash
hoist server create --name prod --type cx22 --region fsn1 --json
hoist deploy --service api --json
hoist template create --name db --type postgres --version 16 --json
hoist env set api DATABASE_URL="postgresql://..." --json
hoist domain add api.myapp.com --service api --json
```

---

## Features

| Feature | Description |
|---------|-------------|
| **Server Provisioning** | Create, list, and destroy VPS instances across multiple providers |
| **App Deployment** | Zero-downtime deploys from Dockerfile with automatic rollback on failure |
| **Database Management** | One-command Postgres, MySQL, Redis, MongoDB via built-in templates |
| **Domain & SSL** | Auto-SSL via Let's Encrypt through Caddy reverse proxy |
| **Environment Variables** | Per-service env vars, runtime injection, masked output |
| **Health Checks** | Endpoint monitoring, container health, disk/CPU/RAM alerts |
| **Rollback** | Instant rollback to previous deployment with one command |
| **Multi-Provider** | Mix Hetzner, Vultr, and DigitalOcean in a single project |
| **Agent Config** | Auto-generates AGENTS.md, Claude Code skills, and Codex skills |
| **Stateless Design** | No local database — server state via SSH, server list via provider API |

---

## Providers

Hoist is provider-agnostic. Configure multiple providers and mix them in a single project.

| Provider | Status |
|----------|--------|
| **Hetzner Cloud** | Supported |
| **Vultr** | Supported |
| **DigitalOcean** | Supported |
| Community contributions | Welcome |

```bash
hoist provider add           # Interactive setup
hoist provider list          # Show configured providers
hoist provider test          # Verify API keys work
hoist provider set-default   # Change default provider
```

---

## Architecture

### Your machine (global, once)

```
~/.hoist/
├── config.json          # Provider API keys, defaults
└── keys/
    ├── hoist_rsa         # SSH private key (auto-generated)
    └── hoist_rsa.pub     # Uploaded to every server
```

### Your project (per repo)

```
my-project/
├── hoist.json            # Declarative config (committed to git)
├── .env.production       # Secrets (gitignored)
├── Dockerfile            # Build instructions
└── AGENTS.md             # Auto-generated agent instructions
```

### Each managed server

```
Server (VPS)
├── Docker Engine          # Container runtime
├── Caddy (container)      # Reverse proxy + auto-SSL
├── App containers         # Your applications
├── Service containers     # Postgres, Redis, etc.
├── Docker volumes         # Persistent data
└── UFW firewall           # Ports 22, 80, 443 only
```

Everything on the server runs in Docker. Containers communicate over an internal Docker network. Databases are never exposed to the public internet.

---

## Project Config

`hoist.json` is the declarative desired state of your project. Committed to git. No secrets.

```json
{
  "project": "my-saas",
  "servers": {
    "prod": {
      "provider": "hetzner-1",
      "type": "cx22",
      "region": "fsn1"
    }
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

## CLI Reference

```bash
hoist init                    # Global setup + provider config
hoist provider add|list|delete|test|set-default  # Manage cloud providers
hoist server create|list|destroy|ssh|status      # Provision and manage VPS
hoist deploy                  # Deploy from Dockerfile
hoist rollback                # Rollback to previous version
hoist template list|info|create|destroy|services|inspect|start|stop|restart  # Service templates
hoist domain add|list|delete  # Custom domains + auto-SSL
hoist env set|get|list|delete|import|export  # Environment variables
hoist logs <service>          # Container logs
hoist status                  # Full project overview
hoist doctor                  # Health check everything
hoist update                  # Regenerate agent config files
```

All commands support `--json` and `--yes`.

---

## Agent Integration

Hoist auto-generates configuration files so any AI agent understands your infrastructure:

| Agent | File |
|-------|------|
| Claude Code | `.claude/skills/hoist/SKILL.md` |
| Codex | `.agents/skills/hoist/SKILL.md` |
| Cursor, Windsurf, Copilot, Gemini | `AGENTS.md` |

Run `hoist init` or `hoist update` to generate these files.

---

## Security

- Provider API keys stored with `600` file permissions
- SSH key-only authentication, password auth disabled
- UFW firewall: only ports 22, 80, 443
- Containers not exposed publicly, only through Caddy
- Databases accessible only via internal Docker network
- Secrets live as container env vars, never in git
- CLI never outputs credential values in JSON

---

## Tech Stack

| Component | Technology |
|-----------|------------|
| CLI | TypeScript, Commander.js |
| Runtime | Node.js >= 18 |
| SSH | ssh2 |
| Reverse Proxy | Caddy |
| Containers | Docker Engine |
| Config | hoist.json |
| Distribution | npm |

---

## Contributing

Contributions are welcome.

```bash
git clone https://github.com/g4f4r0/hoist.git
cd hoist
npm install
npm run build
npm link          # Test locally as `hoist`
npm test          # Run 101 tests
```

---

## License

[MIT](LICENSE)
