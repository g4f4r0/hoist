# Hoist

**Hoist your apps to production. Let your AI agent handle the rest.**

Hoist is an open-source CLI that gives AI coding agents the power to provision servers, deploy apps, manage databases, configure domains, and handle full infrastructure operations. No dashboard. No hosted service. Your agent is the interface, your servers are the source of truth.

```
npm install -g hoist
```

---

## How it works

```
Developer ←→ AI Agent ←→ Hoist CLI ←→ Cloud Provider APIs (Hetzner, Vultr, DO)
                                    ←→ Servers (via SSH)
                                    ←→ Template Registry (GitHub)
```

You install Hoist on your machine. You configure your cloud provider(s). You tell your AI agent what you want. The agent reads the Hoist skill file, asks you clarifying questions, and executes CLI commands to make it happen. Every command outputs structured JSON. The agent reads the output, handles errors, and moves to the next step.

Hoist hosts nothing. Zero infrastructure on our side. The CLI runs on your machine. State lives on your servers. Config lives in your git repo.

---

## Architecture

### On your machine (global, once)

```
~/.hoist/
├── config.json          # Provider API keys, defaults
└── keys/
    ├── hoist_rsa         # SSH private key (auto-generated)
    └── hoist_rsa.pub     # SSH public key (uploaded to servers)
```

### In each project (per repo)

```
my-project/
├── hoist.json            # What should be deployed, where
├── .env.production       # Secrets (gitignored)
├── Dockerfile            # App build instructions
└── src/                  # Your code
```

### On each managed server

```
Server (VPS)
├── Docker Engine
├── Caddy (container)           # Reverse proxy, auto-SSL
├── App containers              # Your applications
├── Database containers         # Postgres, Redis, etc.
├── Docker volumes              # Persistent data
├── /var/log/hoist/             # Audit log
└── UFW firewall                # Ports 22, 80, 443 only
```

Everything on the server is Docker. The only things installed directly are Docker itself and SSH. Caddy, apps, databases, webhook receivers are all containers on a shared Docker network.

---

## No local state

Hoist keeps no database on your machine. The servers are the source of truth.

When the CLI needs to know the current state, it:

1. Reads hoist.json (desired state)
2. Calls the provider API (which servers exist)
3. SSHs into servers (what containers are running)

If your laptop dies, you lose nothing. Install Hoist on a new machine, enter your provider API key(s), clone your repo (has hoist.json), and run `hoist recover`. Done.

---

## Cloud providers

Hoist is provider-agnostic. You can configure multiple providers and mix them within a single project. Each server references a provider by label.

Supported providers:

- Hetzner Cloud
- Vultr
- DigitalOcean
- More via community contributions

Provider config lives in `~/.hoist/config.json`:

```json
{
  "providers": {
    "hetzner-1": {
      "type": "hetzner",
      "apiKey": "****"
    },
    "vultr-prod": {
      "type": "vultr",
      "apiKey": "****"
    }
  },
  "defaults": {
    "provider": "hetzner-1"
  }
}
```

Internally, every provider implements the same interface: create server, list servers, delete server, get pricing, get regions, manage SSH keys. Once a server has an IP and SSH access, everything else is identical regardless of provider.

```
hoist provider add            # Interactive setup
hoist provider list           # Show all configured providers
hoist provider delete         # Delete a provider
hoist provider test           # Verify API keys work
hoist provider set-default    # Change default
```

---

## The config file (hoist.json)

This is the desired state of your project. Committed to git. No secrets.

Servers and services are defined separately. Services reference servers by name.

```json
{
  "project": "my-saas",
  "servers": {
    "main": {
      "provider": "hetzner-1",
      "type": "cx22",
      "region": "fsn1"
    },
    "us-api": {
      "provider": "vultr-prod",
      "type": "vc2-2c-4gb",
      "region": "ewr"
    }
  },
  "services": {
    "api": {
      "server": "main",
      "type": "app",
      "source": ".",
      "dockerfile": "Dockerfile",
      "port": 3000,
      "domain": "api.myapp.com",
      "env_file": ".env.production",
      "autodeploy": {
        "enabled": true,
        "branch": "main",
        "provider": "github"
      },
      "healthCheck": {
        "path": "/health",
        "interval": 30,
        "timeout": 5
      }
    },
    "db": {
      "server": "main",
      "type": "postgres",
      "version": "16"
    },
    "cache": {
      "server": "main",
      "type": "redis",
      "version": "7"
    },
    "us-api": {
      "server": "us-api",
      "type": "app",
      "source": ".",
      "dockerfile": "Dockerfile",
      "port": 3000,
      "domain": "us.myapp.com"
    }
  }
}
```

---

## Setup flow

### Global installation (once per machine)

```
$ npm install -g hoist

$ hoist init

  Welcome to Hoist.

  Let's set up your cloud providers.
  You can add more later with: hoist provider add

  Add a provider? [Hetzner / Vultr / DigitalOcean / Skip for now]
  → Hetzner
  API key: ****
  ✓ Verified. Label: "hetzner-1" (6 regions available)

  Add another? [Hetzner / Vultr / DigitalOcean / Done]
  → Done

  ✓ SSH key pair generated
  ✓ Config saved to ~/.hoist/config.json
  ✓ Skill files available at: hoist skills --path

  Tell your AI agent to read the Hoist skill file. You're ready.
```

### Per-project setup (agent-guided)

The developer tells their agent: "I want to deploy this app."

The agent reads the Hoist skill file and guides the conversation:

```
Agent: I see you have Hoist with 2 providers: hetzner-1 and vultr-prod.
       What kind of app is this?

User:  Node.js API with Postgres.

Agent: Need a new server or do you have one?

User:  New one.

Agent: Pricing comparison for 2 vCPU / 4GB:
       - Hetzner CX22 (Falkenstein, DE): €3.49/mo
       - Vultr vc2-2c-4gb (New Jersey, US): $12/mo
       Which provider?

User:  Hetzner.

Agent: Do you have a domain?

User:  api.myapp.com

Agent: Here's the plan:
       1. Create Hetzner CX22 in Falkenstein
       2. Deploy your Node.js app
       3. Create Postgres 16 database
       4. Wire DATABASE_URL into your app
       5. Configure api.myapp.com with SSL

       Estimated cost: €3.49/mo. Proceed?

User:  Yes.
```

The agent executes:

```bash
$ hoist server create --name main --provider hetzner-1 --type cx22 --region fsn1 --json
$ hoist deploy --service api --source . --server main --port 3000 --json
$ hoist template create --name db --type postgres --version 16 --server main --json
$ hoist env set --service api DATABASE_URL="postgresql://..." --json
$ hoist domain add --service api --domain api.myapp.com --json
```

Each command returns JSON. The agent creates/updates `hoist.json` with the result.

---

## How each operation works

### Server provisioning

```
hoist server create --name main --provider hetzner-1 --type cx22 --region fsn1

1. Read provider credentials from ~/.hoist/config.json
2. Call provider API: create server with Hoist SSH public key
3. Tag server with "hoist" metadata
4. Poll until server is running
5. SSH in, run setup script:
   - Install Docker
   - Configure UFW (22, 80, 443)
   - Disable password SSH auth
   - Start Caddy container
   - Create hoist Docker network
6. Health check
7. Append to /var/log/hoist/audit.log
8. Return JSON:
   {
     "server": "main",
     "provider": "hetzner-1",
     "ip": "x.x.x.x",
     "type": "cx22",
     "region": "fsn1",
     "monthlyCost": "€3.49",
     "status": "ready"
   }
```

### App deployment

```
hoist deploy --service api --source . --server main --port 3000

1. Read Dockerfile from project
2. SSH into server
3. Copy project files via rsync/tar over SSH
4. Build image on server: docker build -t hoist-api:latest .
5. If previous version exists:
   a. Tag current as hoist-api:previous
   b. Start new container on temp port
   c. Health check new container
   d. If healthy: update Caddy routing, drain old, stop old
   e. If unhealthy: stop new, keep old, return error
6. If first deploy: start container, configure Caddy
7. Join hoist Docker network
8. Return JSON:
   {
     "service": "api",
     "server": "main",
     "status": "running",
     "image": "hoist-api:latest",
     "url": "https://api.myapp.com"
   }
```

### Database creation

```
hoist template create --name db --type postgres --version 16 --server main

1. SSH into server
2. Generate 32-char secure password
3. Create Docker volume: hoist-db-data
4. Run container:
   docker run -d \
     --name hoist-db \
     --network hoist \
     --restart unless-stopped \
     -v hoist-db-data:/var/lib/postgresql/data \
     -e POSTGRES_USER=hoist \
     -e POSTGRES_PASSWORD=<generated> \
     -e POSTGRES_DB=app \
     --label hoist.type=postgres \
     --label hoist.version=16 \
     postgres:16-alpine
5. Health check: pg_isready
6. Return JSON:
   {
     "service": "db",
     "type": "postgres",
     "version": "16",
     "connectionString": "postgresql://hoist:<pass>@hoist-db:5432/app",
     "status": "running"
   }
```

Connection string uses Docker network hostname. Not exposed to the public internet. The agent auto-injects this as DATABASE_URL into the app's environment.

### Domain and SSL

```
hoist domain add --service api --domain api.myapp.com

1. SSH into server
2. Update Caddy via its admin API: add route api.myapp.com → container:3000
3. Caddy auto-requests Let's Encrypt certificate
4. Return JSON:
   {
     "domain": "api.myapp.com",
     "service": "api",
     "ssl": "active",
     "serverIp": "x.x.x.x",
     "note": "Point DNS A record for api.myapp.com to x.x.x.x"
   }
```

### Git-push auto-deploy

```
When autodeploy is enabled:

1. Hoist deploys a lightweight webhook receiver container on the server
2. Caddy routes /.hoist/webhook to this container
3. User/agent adds webhook to GitHub:
   URL: https://api.myapp.com/.hoist/webhook
   Secret: <auto-generated>
4. On push to configured branch:
   a. GitHub POSTs to webhook
   b. Receiver validates secret
   c. Runs deploy sequence (clone, build, zero-downtime swap)
   d. Logs result

Toggle per service:
   hoist autodeploy enable --service api
   hoist autodeploy disable --service api
```

### Status check

```
hoist status

1. Read hoist.json (desired state)
2. Query each provider API (servers exist?)
3. SSH into each server:
   - docker ps (running containers)
   - docker stats --no-stream (CPU, RAM)
   - df -h (disk)
   - Caddy config (domains, SSL status)
4. Compare desired vs actual
5. Return JSON:
   {
     "project": "my-saas",
     "servers": [{
       "name": "main",
       "provider": "hetzner-1",
       "ip": "x.x.x.x",
       "cpu": "12%",
       "ram": "1.2GB / 4GB",
       "disk": "8GB / 40GB",
       "monthlyCost": "€3.49",
       "status": "healthy"
     }],
     "services": [{
       "name": "api",
       "status": "running",
       "uptime": "3d 12h",
       "domain": "api.myapp.com",
       "ssl": "valid, expires 2026-06-01",
       "autodeploy": "enabled (main branch)"
     }],
     "databases": [{
       "name": "db",
       "type": "postgres:16",
       "status": "running",
       "size": "256MB"
     }],
     "drift": []
   }
```

### Recovery (new machine)

```
$ npm install -g hoist
$ hoist init
  → enter provider API key(s)
  → new SSH key pair generated

$ hoist recover
  → queries each provider API for servers tagged "hoist"
  → adds new SSH key to each server via provider API
  → tests SSH connections
  → reads running containers and config from servers
  → reports state

$ cd my-project  (cloned from git, has hoist.json)
$ hoist status
  → matches, ready to go
```

### Doctor (health check)

```
hoist doctor

1. Local checks:
   - Config file valid
   - SSH keys exist with correct permissions (600)
   - Provider API keys valid
   - CLI up to date
2. Per server:
   - SSH connection works
   - Docker daemon running
   - Caddy healthy
   - All containers running
   - Disk below 90%
   - No restart loops
   - SSL certs not expiring within 7 days
   - Firewall rules correct
3. Returns pass/fail per check with remediation hints
```

---

## Template registry

Built-in database configs ship with the CLI: Postgres, MySQL, MariaDB, Redis, MongoDB. The agent doesn't need to know Docker details for these. `hoist template create --type postgres` just works.

For everything else (n8n, Plausible, Ghost, Umami, MinIO, Grafana, etc.), there's a public GitHub repo acting as a template registry.

```
hoist-registry/ (GitHub repo)
├── databases/
│   ├── clickhouse/template.json
│   ├── surrealdb/template.json
│   └── valkey/template.json
├── services/
│   ├── n8n/template.json
│   ├── plausible/template.json
│   └── ghost/template.json
├── stacks/
│   ├── saas-starter/template.json
│   └── wordpress/template.json
└── index.json
```

Each template:

```json
{
  "name": "n8n",
  "description": "Workflow automation tool",
  "image": "n8nio/n8n:latest",
  "port": 5678,
  "volumes": {
    "/home/node/.n8n": "n8n-data"
  },
  "env": {
    "N8N_BASIC_AUTH_USER": "{{generate:username}}",
    "N8N_BASIC_AUTH_PASSWORD": "{{generate:password}}"
  },
  "healthCheck": {
    "path": "/healthz",
    "interval": 30
  },
  "requires": ["postgres"],
  "tags": ["automation", "workflow", "no-code"],
  "minResources": { "ram": "1GB", "disk": "10GB" }
}
```

Usage:

```
hoist template search "analytics"
hoist template info plausible
hoist template deploy plausible --server main
→ resolves dependencies, creates containers, wires everything, returns URL
```

Community-contributed via PRs. CI validates every template.

---

## Agent interface

### 1. Skill file (primary)

AGENTS.md teaches the agent everything: CLI reference, decision trees, cost estimation, Docker patterns, error recovery, security rules, conversational guidance. This works with every AI agent (Claude Code, Codex, Cursor, OpenCode, OpenClaw).

The skill file is the product. It turns any agent into an infrastructure expert.

### 2. CLI commands (execution)

Every command: `--json` output to stdout, logs to stderr, semantic exit codes (0=success, 1=error, 2=usage, 3=not found, 4=auth, 5=conflict), `--dry-run` for preview with cost, `--yes` to skip confirmations. Auto-detects non-interactive terminals and suppresses TUI.

### 3. MCP server (optional)

Wraps CLI as MCP tools for agents with native MCP support.

### 4. OpenClaw adapter

ClawHub skill + MCP integration for OpenClaw users. Includes scheduled health checks via heartbeat, messaging alerts, persistent memory.

---

## Complete feature list

### Server management

- Provision VPS from any configured provider
- Select region, type, SSH key during provisioning
- List servers with status, IP, specs, cost
- Server health check (reachable, Docker running, disk/CPU/RAM)
- SSH key generation and upload
- Server setup via SSH: Docker, UFW, Caddy
- Destroy server with cleanup
- Server labels/tags
- Server resize via provider API
- Bring-your-own-server (provide IP + SSH key)
- OS security updates
- Docker daemon monitoring
- SSH key rotation
- SSH session via CLI
- ARM server support

### App deployment

- Deploy from Dockerfile
- Deploy from Docker image
- Deploy Docker Compose stacks
- Deploy from source via Nixpacks
- Deploy from Heroku Buildpacks
- Zero-downtime deploy (start new, health check, swap, stop old)
- Rollback to previous version (keep last N images)
- Deploy logs
- Start, stop, restart, redeploy
- Env var injection at runtime
- Port mapping
- Resource limits (CPU, memory)
- Health check config (endpoint, interval, timeout, retries)
- Connection draining
- Build on separate server
- Preview deployments per branch/PR
- Deployment history
- Canary deployments
- Container exec and terminal access

### Git integration and CI/CD

- Webhook receiver for GitHub, GitLab, Bitbucket, Gitea
- Auto-deploy on push to configured branch
- Enable/disable auto-deploy per service
- Manual deploy via CLI
- Branch config per service
- Deploy on tag/release
- PR preview environments (auto-create, auto-destroy)
- Deploy status posted back to git provider
- Multiple branches to different environments
- Webhook secret validation
- Monorepo support
- Custom build/pre-deploy/post-deploy hooks
- Deploy via API trigger

### Database management

- Create Postgres, MySQL, MariaDB, Redis, MongoDB containers
- Configurable versions
- Persistent volumes
- Auto-generate secure passwords
- Output and auto-inject connection strings
- Start, stop, restart
- Database logs
- Automated backups on schedule
- Backup to S3-compatible storage or local
- Restore from backup
- Backup retention policy
- Version upgrades
- Connection pooling (PgBouncer)
- Size monitoring and alerts
- Point-in-time recovery (Postgres WAL)
- Database cloning for staging

### Domain and SSL

- Custom domains per service
- Caddy auto-SSL via Let's Encrypt
- Auto-generated domains for services without custom domain
- Subdomain routing
- Wildcard domains and SSL
- Multiple domains per service
- DNS provider integration (Cloudflare, Hetzner DNS)
- DNS verification before SSL
- Redirect rules (www, HTTP)
- Path-based routing
- Domain health check and cert monitoring
- Custom error pages
- IP allowlisting per domain

### Reverse proxy (Caddy)

- Caddy as Docker container on each server
- Dynamic config via Caddy admin API
- Automatic HTTPS
- Domain-to-container routing
- Internal Docker network
- Health check before routing
- Rate limiting
- Basic auth per route
- Custom headers (CORS, security, cache)
- WebSocket proxying
- Access logs
- Config backup/restore
- Compression (gzip, brotli)

### Environment variables and secrets

- Per-service env vars
- Runtime injection into containers
- Env file support
- Auto-generated secrets
- Masked values in output
- Update triggers container restart
- Shared vars across services
- Environment-level vars (production, staging)
- Rotation without downtime
- Change history
- Bulk import/export
- Encrypted storage at rest
- Agent safety: never log or output secret values

### Logging and monitoring

- Container log streaming
- Log retrieval (last N lines, JSON)
- Build and deploy logs
- Server resource monitoring (CPU, RAM, disk)
- Container resource usage
- Log persistence
- Log search and filtering
- Structured JSON output for agents
- Health check monitoring
- Disk space alerts
- Crash/restart alerts
- Notifications: Discord, Slack, Telegram, email, custom webhook
- Custom alert rules
- Uptime monitoring
- Cost tracking per resource
- Cost alerts and budget caps
- Log forwarding to external services

### Storage and volumes

- Named Docker volumes
- Volume listing per server
- Volume size reporting
- Auto volume creation for databases
- Volume backup and restore
- Disk monitoring and cleanup alerts
- Old image pruning
- Build cache cleanup
- Volume snapshots via provider API
- Shared volumes across containers

### Firewall and security

- Auto UFW setup (22, 80, 443)
- Containers not exposed publicly (Caddy only)
- SSH key-only auth
- Custom firewall rules
- Fail2ban
- Non-root containers
- Auto security updates
- IP allowlisting
- Container vulnerability scanning
- SSH audit logging

### Cron jobs

- Scheduled tasks per service (cron expressions)
- Run command in container on schedule
- Standalone containers on schedule (spin up, run, destroy)
- Cron logs and history
- Enable/disable
- Manual trigger
- Failure notifications

### Environments

- Multiple per project (production, staging, dev, custom)
- Environment-specific servers
- Environment-specific env vars and secrets
- Environment-specific domains
- Clone environments
- Per-environment deploy permissions

### Cost management

- Track resources and costs
- Pre-provisioning cost estimates (dry-run)
- Budget caps per project
- Budget alerts
- Cost breakdown by server, service, database
- Monthly summaries
- Pricing from provider API

### Config file (hoist.json)

- Project metadata
- Server definitions (provider, type, region)
- Service definitions (type, server, source, domain, port, env, health check)
- Database definitions (type, version, server, backup)
- Cron definitions
- Domain definitions
- Auto-detection in project root
- Validation before operations
- Agent creates through guided conversation
- No secrets (committed to git)
- Environment overrides
- Config diffing
- JSON Schema for validation

### CLI commands

```
hoist init                              # Global setup
hoist provider add/list/delete/test     # Manage cloud providers

hoist server create                     # Provision VPS
hoist server list                       # List all servers
hoist server status <name>              # Server details
hoist server resize <name>              # Vertical scaling
hoist server destroy <name>             # Destroy server
hoist server ssh <name>                 # Open SSH session

hoist deploy                            # Deploy from hoist.json
hoist deploy --service <name>           # Deploy single service
hoist rollback <service>                # Rollback to previous
hoist exec <service> <command>          # Run in container

hoist template create                         # Create database
hoist template services                           # List databases
hoist template backup <name>                  # Manual backup
hoist template restore <name> <backup>        # Restore from backup
hoist template destroy <name>                 # Destroy database

hoist domain add <domain> --service <s> # Add domain
hoist domain list                       # List all domains
hoist domain delete <domain>            # Delete domain
hoist domain verify <domain>            # Check DNS

hoist env set <service> KEY=value       # Set env var
hoist env get <service> KEY             # Get env var
hoist env list <service>                # List env vars (masked)
hoist env delete <service> KEY          # Delete env var
hoist env import <service> <file>       # Bulk import
hoist env export <service>              # Bulk export

hoist logs <service>                    # Stream logs
hoist status                            # Full project overview
hoist doctor                            # Health check everything
hoist cost                              # Cost breakdown
hoist recover                           # Rebuild from servers
hoist destroy                           # Tear down everything

hoist autodeploy enable --service <s>   # Enable git push deploy
hoist autodeploy disable --service <s>  # Disable git push deploy

hoist cron list                         # List cron jobs
hoist cron trigger <name>               # Manual trigger
hoist cron enable/disable <name>        # Toggle

hoist template search <query>           # Search registry
hoist template info <name>              # Template details
hoist template deploy <name>            # Deploy from template

hoist config validate                   # Validate hoist.json
hoist config diff                       # Changes since last deploy
hoist update                            # Self-update CLI
hoist skills --path                     # Show skill file location
```

All commands support `--json`, `--dry-run`, `--yes`.

---

## Security model

- **Provider API keys** stored in `~/.hoist/config.json` with 600 file permissions
- **SSH key pair** generated per machine, stored in `~/.hoist/keys/` with 600 permissions
- **Server access** SSH key-only, password auth disabled
- **Firewall** UFW: ports 22, 80, 443 only
- **Containers** not exposed to public internet, only through Caddy
- **Databases** only accessible via Docker internal network
- **Secrets** live as container env vars on server, never in hoist.json, never in git
- **Audit log** on each server, every action timestamped
- **CLI never outputs credentials** in JSON (values masked)
- **Env var support** for provider keys (HOIST_HETZNER_KEY, etc.) for CI/CD
- **CLI warns** on wrong file permissions or secrets detected in hoist.json

Recovery requires only your provider API key(s). Everything else is regenerated or read from servers.

---

## What Hoist doesn't do

- **No web dashboard.** Your agent is the UI.
- **No hosted service.** We run nothing. You own everything.
- **No local state.** Servers are the source of truth.
- **No Kubernetes or Docker Swarm.** Plain Docker containers.
- **No cross-server networking.** Same-server services share Docker network. Different servers are independent.
- **No serverless or edge functions.** Long-running containers on VPSs.
- **No full CI pipeline.** Git webhook deploys, not test stages.
- **No multi-tenancy.** Single user, local CLI. Teams share via git repo and provider access.
- **No vendor lock-in.** Standard Docker. Switch providers anytime.

---

## Technology stack

| Component         | Technology                                         |
| ----------------- | -------------------------------------------------- |
| CLI               | TypeScript + Commander.js                          |
| Runtime           | Node.js or Bun                                     |
| SSH               | ssh2 (Node library)                                |
| Providers         | Hetzner, Vultr, DigitalOcean (pluggable interface) |
| Reverse proxy     | Caddy (Docker container)                           |
| Containers        | Docker Engine                                      |
| Build             | Dockerfile (primary) + Nixpacks (fallback)         |
| Config            | hoist.json                                         |
| Agent interface   | AGENTS.md + optional MCP + OpenClaw                |
| Template registry | GitHub repository                                  |
| Distribution      | npm (npx hoist init)                               |

---

## Distribution

```
npx hoist init                           # Zero install, instant
npm install -g hoist                     # Global install
brew install hoist                       # macOS
curl -fsSL https://hoist.dev/install.sh | sh   # Servers/CI
```
