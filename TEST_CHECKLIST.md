# Hoist CLI — End-to-End Test Walkthrough

A real user journey from zero to cleanup. Run every command, check every response.

Estimated time: ~30 min. Cost: < €0.50 (servers destroyed at end).

---

## Phase 0: Clean Install

```bash
rm -rf ~/.hoist
rm -f hoist.json
npm run build && npm link
```

- [ ] `which hoist` → path to binary
- [ ] `hoist --version` → `0.1.5`

---

## Phase 1: First-Time Setup

### The user has never used Hoist before.

```bash
hoist init
```
- [ ] Shows banner: `Hoist 0.1.5 — <random tagline>`
- [ ] Prompts: provider selector (hetzner/vultr/digitalocean/hostinger/linode/scaleway)
- [ ] Type `hetzner`
- [ ] Prompts: `API key:`
- [ ] Paste your Hetzner API key
- [ ] Shows API guide URL and permissions
- [ ] Spins `Verifying hetzner-<random-name>...`
- [ ] Prints `hetzner-<random-name> verified`
- [ ] Outro: `Ready! Tell your AI agent: hoist server create`
- [ ] `cat ~/.hoist/config.json` → has provider entry with apiKey, random label
- [ ] `ls -la ~/.hoist/keys/hoist_ed25519` → mode 0600

### Now the agent has a working config. Simulate agent calling init:

```bash
echo "" | hoist init
```
- [ ] No prompt (not a TTY)
- [ ] NDJSON result: `status=ready` (config already has provider)
- [ ] `next.actor=agent`, `next.command=hoist server create`

### Init with no provider and no TTY (agent path, fresh machine):

```bash
rm -rf ~/.hoist
echo "" | hoist init
```
- [ ] NDJSON result: `status=needs_provider`
- [ ] `next.actor=user`, action says run `hoist init` in terminal

```bash
# Restore config for remaining tests
hoist init
```
- [ ] Interactive prompt again, enter hetzner + key
- [ ] `status=ready`

### Init with bad key:

```bash
rm -rf ~/.hoist
hoist init
```
- [ ] Type `hetzner`
- [ ] Type `fake-key-12345`
- [ ] Prints `Verification failed: ...`
- [ ] NDJSON result: `status=needs_provider` (failed provider in results)

```bash
# Restore with real key
hoist init
```
- [ ] Real key this time → `status=ready`

### Init with env var (CI/automation path):

```bash
rm -rf ~/.hoist
HOIST_HETZNER_API_KEY=<your-key> hoist init
```
- [ ] No interactive prompt (env var found)
- [ ] NDJSON result: `status=ready`, providers array has hetzner-1

```bash
# Restore for remaining tests if needed
hoist init
```

---

## Phase 2: Provider Management

### List providers:

```bash
hoist provider list
```
- [ ] Array with `label=hetzner-1`, `type=hetzner`, `default=true`

### Test provider connection:

```bash
hoist provider test
```
- [ ] Array with `label=hetzner-1`, `ok=true`

```bash
hoist provider test hetzner-1
```
- [ ] Same, single result

### Add provider without env var:

```bash
unset HOIST_VULTR_API_KEY
hoist provider add --type vultr
```
- [ ] Error: no API key
- [ ] `next.actor=user`, action has the command to run

### Add provider with bad key:

```bash
HOIST_VULTR_API_KEY=fake-key hoist provider add --type vultr --label vultr-test
```
- [ ] Error: verification failed

### Add duplicate:

```bash
HOIST_HETZNER_API_KEY=<your-key> hoist provider add --type hetzner
```
- [ ] Error: `Provider "hetzner-1" already exists.`

### Delete — requires --confirm:

```bash
hoist provider delete hetzner-1
```
- [ ] Error: "Re-run with --confirm"
- [ ] `next.actor=agent`, `next.command=hoist provider delete hetzner-1 --confirm`

```bash
hoist provider delete nonexistent --confirm
```
- [ ] Error: "not found"

### Update provider:

```bash
hoist provider update hetzner-1
```
- [ ] Reads from HOIST_HETZNER_API_KEY env var
- [ ] Result: `status=updated`

### Update without env var:

```bash
unset HOIST_HETZNER_API_KEY
hoist provider update hetzner-1
```
- [ ] Error: no API key
- [ ] `next.actor=user`, action has command to run

### Set default:

```bash
hoist provider set-default hetzner-1
```
- [ ] Result: `status=success`

---

## Phase 3: Status & Doctor (Pre-Project)

```bash
hoist --status
```
- [ ] Result: `version`, `configured=true`, `sshKeys=true`, providers array

```bash
hoist doctor
```
- [ ] Result: `status` field, checks array
- [ ] Skips project checks (no hoist.json)

### Status when unconfigured:

```bash
rm -rf ~/.hoist
hoist --status
```
- [ ] Result: `configured=false`
- [ ] `next.actor=agent`, `next.command=hoist init`

```bash
# Restore
hoist init
# Enter hetzner + key
```

---

## Phase 4: Server Create

### Create with explicit flags:

```bash
hoist server create --name test-explicit --type cx22 --region fsn1
```
- [ ] Progress lines: `type=progress`, `phase=provision`
- [ ] Result: `server=test-explicit`, IP, `status=ready`
- [ ] `next.actor=agent`, `next.command=hoist deploy`

### Verify:

```bash
hoist server list
```
- [ ] Array contains test-explicit with IP

```bash
hoist server status test-explicit
```
- [ ] `health.healthy=true`, Traefik running

### Create with smart defaults:

```bash
hoist server create
```
- [ ] Progress lines for regions, types, provisioning
- [ ] Random 3-word name, cheapest type
- [ ] `next.actor=agent`, `next.command=hoist deploy`
- [ ] Record random name: `_____________`

```bash
hoist server list
```
- [ ] Both servers listed

### Create without init:

```bash
rm -rf ~/.hoist
hoist server create
```
- [ ] Error: "Run 'hoist init' first."
- [ ] `next.actor=agent`, `next.command=hoist init`

```bash
# Restore
hoist init
# Enter hetzner + key
```

### SSH into server:

```bash
hoist server ssh test-explicit
```
- [ ] Opens interactive shell

```bash
# Inside the server:
docker ps                         # hoist-traefik running
cat /etc/traefik/traefik.yml      # static config
ls /etc/traefik/dynamic/          # directory exists
exit
```
- [ ] All pass

### SSH to nonexistent server:

```bash
hoist server ssh nonexistent
```
- [ ] Error: "not found or has no IP"

---

## Phase 5: Project Config

Create test project files:

```bash
mkdir -p /tmp/hoist-e2e && cd /tmp/hoist-e2e
```

**hoist.json**
```json
{
  "project": "e2e-test",
  "servers": {
    "test-explicit": { "provider": "hetzner-1" }
  },
  "services": {
    "api": {
      "server": "test-explicit",
      "type": "app",
      "source": ".",
      "port": 3000
    }
  }
}
```

**index.js**
```js
const http = require("http");
const server = http.createServer((req, res) => {
  if (req.url === "/health") { res.writeHead(200); res.end("ok"); return; }
  res.writeHead(200);
  res.end("Hello from Hoist e2e test");
});
server.listen(3000, "0.0.0.0", () => console.log("Listening on 3000"));
```

**package.json**
```json
{ "name": "e2e-test", "version": "1.0.0", "main": "index.js" }
```

**Dockerfile**
```dockerfile
FROM node:20-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
EXPOSE 3000
CMD ["node", "index.js"]
```

### Validate:

```bash
hoist config validate
```
- [ ] Result: `status=valid`, `project=e2e-test`, `servers=1`, `services=1`
- [ ] `next.actor=agent`, `next.command=hoist deploy`

### Validate with no hoist.json:

```bash
cd /tmp && hoist config validate
```
- [ ] Error about missing hoist.json

```bash
cd /tmp/hoist-e2e
```

---

## Phase 6: Deploy & Auto-Domains

### First deploy:

```bash
hoist deploy
```
- [ ] Progress: upload, build, health check, route
- [ ] Result array: `service=api`, `status=running`, `url=https://api.<IP-dashed>.sslip.io`
- [ ] `next.actor=agent`, `next.command=hoist status`

### Verify app is live:

```bash
curl http://<server-ip>:3000
```
- [ ] Returns "Hello from Hoist e2e test"

```bash
curl https://api.<IP-dashed>.sslip.io
```
- [ ] Returns "Hello from Hoist e2e test" (HTTPS via sslip.io)

### Status after deploy:

```bash
hoist status
```
- [ ] Services array: api running, drift empty

### Deploy specific service:

Edit `index.js` → change response to `"v2"`.

```bash
hoist deploy --service api
```
- [ ] Result: `status=running`

```bash
curl http://<server-ip>:3000
```
- [ ] Returns "v2"

### Deploy nonexistent service:

```bash
hoist deploy --service nonexistent
```
- [ ] Error: "not found or is not an app service"

---

## Phase 7: Rollback

### Rollback (single service auto-select):

```bash
hoist rollback
```
- [ ] Result: `status=rolled-back`, url with auto-domain
- [ ] `next.actor=agent`, `next.command=hoist status`

```bash
curl http://<server-ip>:3000
```
- [ ] Returns "Hello from Hoist e2e test" (original)

### Rollback explicit service:

```bash
hoist rollback --service api
```
- [ ] Result: `status=rolled-back`

### Rollback nonexistent service:

```bash
hoist rollback --service nonexistent
```
- [ ] Error: "not found or is not an app service"

---

## Phase 8: Database (Template)

### List templates:

```bash
hoist template list
```
- [ ] Array: postgres, mysql, mariadb, redis, mongodb

### Template info:

```bash
hoist template info postgres
```
- [ ] Result: template details

```bash
hoist template info nonexistent
```
- [ ] Error: "not found"

### Create Postgres:

```bash
hoist deploy --template postgres --server test-explicit
```
- [ ] Progress lines
- [ ] Result: `connectionString`, `sshTunnel`, `status=running`
- [ ] `next` mentions setting env var with `hoist env set`

### Inspect:

```bash
hoist template inspect postgres --server test-explicit
```
- [ ] Result: type, version, connectionString, status

### List services:

```bash
hoist template services --server test-explicit
```
- [ ] Array includes postgres

### Create Redis:

```bash
hoist deploy --template redis --server test-explicit
```
- [ ] Result: `status=running`

```bash
hoist template services --server test-explicit
```
- [ ] Array: postgres + redis

### Stop/start/restart:

```bash
hoist template stop postgres --server test-explicit
```
- [ ] Result: `status=stopped`

```bash
hoist template start postgres --server test-explicit
```
- [ ] Result: `status=running`

```bash
hoist template restart redis --server test-explicit
```
- [ ] Result: `status=running`

### Backup:

```bash
hoist template backup postgres --server test-explicit
```
- [ ] Result: file path, `size > 0`
- [ ] File actually exists locally

### Destroy — requires --confirm:

```bash
hoist template destroy redis --server test-explicit
```
- [ ] Error: "Re-run with --confirm"
- [ ] `next.actor=agent`, `next.command` includes `--confirm`

```bash
hoist template destroy redis --server test-explicit --confirm
```
- [ ] Result: `status=destroyed`

```bash
hoist template services --server test-explicit
```
- [ ] Only postgres remains

---

## Phase 9: Environment Variables

### Set:

```bash
hoist env set api DATABASE_URL=postgres://test NODE_ENV=production LOG_LEVEL=info
```
- [ ] Result: `updated` array has all three

### Get:

```bash
hoist env get api DATABASE_URL
```
- [ ] Result: `key=DATABASE_URL`, value matches

```bash
hoist env get api NONEXISTENT
```
- [ ] Error: "not found"

### List:

```bash
hoist env list api
```
- [ ] env object has DATABASE_URL, NODE_ENV, LOG_LEVEL

### Delete:

```bash
hoist env delete api LOG_LEVEL
```
- [ ] Result: `deleted=LOG_LEVEL`

```bash
hoist env list api
```
- [ ] LOG_LEVEL gone

### Delete nonexistent:

```bash
hoist env delete api NONEXISTENT
```
- [ ] Error: "not found"

### Stdin:

```bash
echo "STDIN_VAR=hello" | hoist env set api --stdin
```
- [ ] Result: `updated=[STDIN_VAR]`

```bash
hoist env get api STDIN_VAR
```
- [ ] value=hello

### Stdin from file:

```bash
cat <<'EOF' > .env.stdin
# This is a comment
BATCH_A=one
BATCH_B=two
EOF
cat .env.stdin | hoist env set api --stdin
hoist env list api
```
- [ ] BATCH_A and BATCH_B present

### Import:

```bash
cat <<'EOF' > .env.test
SECRET_KEY=abc123
REDIS_URL=redis://localhost:6379
EOF
hoist env import api .env.test
```
- [ ] Result: `imported=[SECRET_KEY, REDIS_URL]`

```bash
hoist env list api
```
- [ ] SECRET_KEY and REDIS_URL present

### Export:

```bash
hoist env export api
```
- [ ] All keys present in env object

---

## Phase 10: Domain (Optional — needs real domain)

> Skip if no domain available.

### Add:

```bash
hoist domain add test.yourdomain.com
```
- [ ] Auto-selects api service
- [ ] Result: domain, service, serverIp
- [ ] `next.actor=user`, action mentions DNS

### Verify SSL:

```bash
curl https://test.yourdomain.com
```
- [ ] Returns app response, valid cert

### List:

```bash
hoist domain list
```
- [ ] Array with appName, domain, upstream, server

### Delete — requires --confirm:

```bash
hoist domain delete test.yourdomain.com
```
- [ ] Error with `next.command` including `--confirm`

```bash
hoist domain delete test.yourdomain.com --confirm
```
- [ ] Result: `status=deleted`

```bash
hoist domain list
```
- [ ] Empty array

---

## Phase 11: Logs & Doctor

### Logs:

```bash
hoist logs api
```
- [ ] Result with `lines` array

```bash
hoist logs api --lines 5
```
- [ ] 5 lines

```bash
hoist logs api --follow
# Ctrl+C to stop
```
- [ ] Raw streaming output

### Logs bad service:

```bash
hoist logs nonexistent
```
- [ ] Error

### Doctor (full project):

```bash
hoist doctor
```
- [ ] `status=healthy`, all checks pass
- [ ] Checks include: config-dir, config-file, ssh-keys, provider, ssh, docker, traefik
- [ ] No `next` field (healthy = nothing to do)

---

## Phase 12: Keys

### Show:

```bash
hoist keys show
```
- [ ] Result: publicKeyPath, fingerprint, publicKey

### Rotate — requires --confirm:

```bash
hoist keys rotate
```
- [ ] Error: "Re-run with --confirm"
- [ ] `next.actor=agent`, `next.command=hoist keys rotate --confirm`

```bash
hoist keys rotate --confirm
```
- [ ] Progress lines
- [ ] Result: `status=success`, serversUpdated count

```bash
hoist keys show
```
- [ ] Fingerprint changed

```bash
hoist server status test-explicit
```
- [ ] SSH still works with new key

---

## Phase 13: Server Import (Optional)

> Skip if no extra server with SSH access.

```bash
hoist server import --ip <ip> --user root
```
- [ ] Progress: SSH test, key upload, setup
- [ ] Result: random name, `provider=imported`, `status=ready`
- [ ] `next.actor=agent`, `next.command=hoist deploy`

```bash
hoist server import --ip <ip> --name my-imported
```
- [ ] Result: `server=my-imported`

```bash
hoist server import
```
- [ ] Error: "--ip is required"

```bash
hoist server list
```
- [ ] Includes imported server(s)

---

## Phase 14: Multi-Service

Update `hoist.json` — add second service:
```json
"web": {
  "server": "test-explicit",
  "type": "app",
  "source": "./web",
  "port": 8080
}
```

Create `web/index.js` (port 8080), `web/package.json`, `web/Dockerfile`.

```bash
hoist config validate
```
- [ ] `services=2`

### Deploy all:

```bash
hoist deploy
```
- [ ] Both services deployed
- [ ] Both get auto-domain URLs: `api.<IP>.sslip.io` and `web.<IP>.sslip.io`

### Deploy specific:

```bash
hoist deploy --service web
hoist deploy --service api
hoist status
```
- [ ] Both running

### Rollback requires --service when multiple:

```bash
hoist rollback
```
- [ ] Error: "Multiple app services found. Use --service to specify one."
- [ ] `next.actor=agent`, `next.command` includes `--service`

```bash
hoist rollback --service web
```
- [ ] Result: `status=rolled-back`

### Domain with service selection:

```bash
hoist domain add multi.yourdomain.com
```
- [ ] Error: "Multiple app services found. Use --service to specify one."
- [ ] `next.actor=agent`, command includes `--service`

```bash
hoist domain add multi.yourdomain.com --service web
```
- [ ] Result: domain, service=web

---

## Phase 15: Cleanup

### Destroy database:

```bash
hoist template destroy postgres --server test-explicit
```
- [ ] Error: "Re-run with --confirm"

```bash
hoist template destroy postgres --server test-explicit --delete-volumes --confirm
```
- [ ] Result: `status=destroyed`

### Destroy servers:

```bash
hoist server destroy test-explicit
```
- [ ] Error: "Re-run with --confirm"
- [ ] `next.actor=agent`, `next.command=hoist server destroy test-explicit --confirm`

```bash
hoist server destroy test-explicit --confirm
```
- [ ] Result: `status=destroyed`

```bash
hoist server destroy <random-name> --confirm
```
- [ ] Result: `status=destroyed`

```bash
hoist server list
```
- [ ] Empty array

```bash
hoist --status
```
- [ ] Provider still configured, no servers

### Verify on Hetzner dashboard:
- [ ] No servers remain

---

## Phase 16: NDJSON Protocol

Spot-check output format:

```bash
hoist provider list | jq '.data'
hoist doctor | jq '.data.checks'
hoist config validate | jq '.data.project'
```
- [ ] All parseable by jq

### Format rules:
- [ ] Errors: `{"type":"error","message":"..."}`
- [ ] Progress: `{"type":"progress","phase":"...","message":"...","timestamp":"..."}`
- [ ] Results: `{"type":"result","status":"success","data":...}`
- [ ] `next` field: `{"actor":"user"|"agent","action":"..."}`, optional `command`
- [ ] `--confirm` errors have exact re-run command in `next.command`
- [ ] "Run hoist init first" errors have `next.command=hoist init`
- [ ] Env var missing errors have `next.actor=user`
- [ ] Successful deploys have `next.command=hoist status`
- [ ] `next` absent on list/get commands (terminal results)

---

## Phase 17: Update

```bash
hoist update
```
- [ ] Result: `skills=updated`, cli version info
- [ ] `next.actor=agent`, action mentions restarting

---

## Results

| Phase | Pass | Fail | Notes |
|-------|------|------|-------|
| 0. Clean install | | | |
| 1. First-time setup | | | |
| 2. Provider management | | | |
| 3. Status & doctor (pre-project) | | | |
| 4. Server create | | | |
| 5. Project config | | | |
| 6. Deploy & auto-domains | | | |
| 7. Rollback | | | |
| 8. Database (template) | | | |
| 9. Environment variables | | | |
| 10. Domain | | | |
| 11. Logs & doctor | | | |
| 12. Keys | | | |
| 13. Server import | | | |
| 14. Multi-service | | | |
| 15. Cleanup | | | |
| 16. NDJSON protocol | | | |
| 17. Update | | | |

**Total: ~120 test cases**
