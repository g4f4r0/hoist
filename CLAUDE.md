# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is Hoist

Open-source CLI that gives AI coding agents the power to provision servers, deploy apps, manage databases, configure domains, and handle infrastructure on VPS providers. No dashboard, no hosted service. The CLI outputs structured JSON so AI agents can drive it programmatically.

## Commands

```bash
npm run build          # Build with tsup → dist/cli.js (ESM, shebang, sourcemaps)
npm run dev            # Build in watch mode
npm run typecheck      # tsc --noEmit (strict mode)
node dist/cli.js       # Run the CLI directly
```

No test framework is configured yet. No ESLint config exists yet (script defined but no config file).

## Architecture

**Entry point:** `src/cli.ts` registers command groups via Commander.js → `init`, `provider`, `server`, `deploy`, `rollback`, `domain`, `status`, `template`, `env`, `logs`, `doctor`, `update`.

**Three layers:**

1. **Commands** (`src/commands/`) — User-facing CLI commands. Use `@clack/prompts` for interactive flows, support `--json` for machine output, `--yes` to skip confirmations. Commands resolve providers, gather params (interactively or via flags), then call into lib/providers.

2. **Lib** (`src/lib/`) — Shared infrastructure: config I/O, SSH connection pool, key generation, server setup, structured output.

3. **Providers** (`src/providers/`) — Cloud provider implementations behind a common `Provider` interface. Each provider uploads SSH key, creates server via API, polls until running, tags with `managed-by=hoist`. Adding a new provider = one file implementing the interface + registering in `index.ts`.

## Project Structure

```
src/
  cli.ts                  # Entry point
  commands/               # CLI command handlers
  lib/                    # Shared utilities and core logic
  providers/              # Cloud provider implementations
```

Organize by domain, not by technical role. As the project grows:
- `src/commands/` — one file per command group (`server.ts`, `provider.ts`, `template.ts`)
- `src/providers/` — one file per provider (`hetzner.ts`, `vultr.ts`)
- `src/lib/` — shared infrastructure used across commands
- `src/types/` — shared type definitions when types are used across multiple domains

Do not create `utils/`, `helpers/`, or `common/` folders. If something is shared, it goes in `lib/`. If it's domain-specific, it stays in its domain file.

## Naming

### Files and directories
- `kebab-case` for all files and directories: `server-setup.ts`, `ssh-keys.ts`
- Filename matches primary export: `hetzner.ts` exports `hetznerProvider`
- One domain per file. If a file has two unrelated exports, split it.

### Variables and functions
- `camelCase` for variables, functions, and methods
- `PascalCase` for types, interfaces, and classes
- `SCREAMING_SNAKE_CASE` for constants: `API_BASE`, `KNOWN_HOSTS_PATH`
- Short and direct: `servers` not `serversData`, `user` not `userData`
- No redundant type in name: `phone` not `phoneNumber`, `email` not `emailAddress`
- `row` for single db result, plural for collections

### CRUD operations

| Operation | Prefix |
|-----------|--------|
| Read one | `get` |
| Read many | `list` |
| Create | `create` |
| Update | `update` |
| Delete | `delete` |

One `get` per domain with optional lookup fields instead of `getByPhone`, `getByEmail`, etc.
One `update` per domain with `id` plus optional partial fields.

### Non-CRUD prefixes

| Prefix | Use |
|--------|-----|
| `handle` | Entry points from webhooks and external events |
| `format` | Transform data for display |
| `on` | Side-effect reactions |
| `has` / `is` | Boolean checks |
| `count` | Numeric aggregations |
| `with` | Enrichment or decoration |
| `check` | Diagnostic operations returning structured results |

These tables are guidance for domain operations, not an exhaustive allowlist. Standard programming terms like `close`, `read`, `generate`, `set`, `ensure`, `setup`, `output`, `validate`, `exec`, `parse` are fine when they are the natural term for what the function does.

## Code Style

### Functions
- Single return type. Don't return `string | null | undefined` — pick one falsy representation.
- Prefer early returns over nested conditionals.
- Max one level of callback nesting.

### Types
- `interface` for public contracts (Provider, ServerInfo). `type` for unions and utilities.
- No `enum` — use `as const` objects or union literals.
- No `any` — use `unknown` and narrow.

### Imports
- Node builtins with `node:` prefix: `import fs from "node:fs"`
- Group: node builtins → external packages → internal modules
- ssh2 is CJS: import as `import ssh2 from "ssh2"` then destructure, not named imports.

### Comments
- JSDoc per exported function only. One sentence. No parentheses or em dashes.
- No inline comments unless truly non-obvious logic.
- No numbered step comments.

### Error handling
- Throw descriptive errors in library code. Catch and format at command level.
- Exit codes: 0=success, 1=error, 2=usage, 3=not found, 4=auth, 5=conflict.

## Key Patterns

- **hoist.json is read-only input**: CLI reads and validates it, never writes it. The agent creates/updates hoist.json. Types and loader in `src/lib/project-config.ts`.
- **Server resolution**: hoist.json server names are resolved to IPs via provider API calls. No local IP cache. See `src/lib/server-resolve.ts`.
- **Zero-downtime deploys**: Build new image → start `-new` container → health check → swap Caddy → stop old → rename. Supports local upload or git clone (`--repo`). See `src/lib/deploy.ts`.
- **Rollback**: Swaps `:latest` and `:previous` image tags, recreates container. See `src/commands/rollback.ts`.
- **Caddy config via admin API**: Routes managed by reading/writing Caddy JSON config through `docker exec wget` over SSH. See `src/lib/caddy.ts`.
- **Template system**: Built-in templates in `src/lib/templates/` define how to run Docker services (image, env, volumes, health check, connection string). `{{generate:password}}` and `{{env:KEY}}` variables resolved at deploy time. Same schema for databases and future app templates.
- **Container env management**: Read env via `docker inspect`, update by stop/rm/run with new env (Docker doesn't support live env updates). See `src/lib/container-env.ts`.
- **All provider API helpers** follow the same shape: `api()` returns raw Response, `apiJson<T>()` returns parsed and throws on auth errors.
- **Server setup is idempotent**: Uses `which X || install X` and `docker inspect X || docker run X` patterns so it can be re-run safely.
- **Smart server defaulting**: Commands with `--server` auto-pick the only server if config has just one. Use `getDefaultServer()` from project-config.ts.
- **Stateless design**: No local database. Server list comes from provider APIs (filtered by hoist tags). Server state comes from SSH. Config is just credentials and defaults.
- **Dual-mode output**: `--json` sends structured JSON to stdout. Human output goes to stderr via chalk. Every command supports both.

## QA Feedback Loops

After completing a phase or significant batch of changes, run feedback loops to verify all files comply with these conventions. Deploy parallel review agents across all changed files. Each loop checks: naming, JSDoc, types, imports, error handling, return types, inline comments, casing.

- Fix all violations found, then re-run
- Continue until **3 consecutive clean loops** with zero violations
- Dismiss false positives only when the agent misreads a rule (document the reasoning)
- Common catches: split imports from same module, section-header comments, unused params, inline comments on self-evident code

## Commits

Conventional commits, lowercase, no period. Keep it short.

| Prefix | Use |
|--------|-----|
| `feat:` | New functionality |
| `fix:` | Bug fix |
| `refactor:` | Code change that doesn't add features or fix bugs |
| `chore:` | Build, deps, config, tooling |
| `docs:` | Documentation only |
| `style:` | Formatting, whitespace |
| `test:` | Adding or fixing tests |

Examples: `feat: add server deploy command`, `fix: ssh connection timeout on slow networks`, `chore: bump ssh2 to v1.16`

## Build

tsup bundles `src/cli.ts` → single `dist/cli.js` file (ESM, target node18). The `bin` field in package.json points to `dist/cli.js` for global install via npm.
