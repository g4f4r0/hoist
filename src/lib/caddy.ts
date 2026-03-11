import { execOrFail, type SSHConnectionOptions } from "./ssh.js";

interface CaddyRoute {
  match: Array<{ host: string[] }>;
  handle: Array<{
    handler: string;
    upstreams: Array<{ dial: string }>;
  }>;
  terminal: boolean;
}

interface CaddyConfig {
  apps?: {
    http?: {
      servers?: {
        srv0?: {
          listen?: string[];
          routes?: CaddyRoute[];
        };
      };
    };
  };
}

const DOCKER_WGET = "docker exec hoist-caddy wget -q -O-";
const ADMIN_URL = "http://localhost:2019";

function buildRoute(domain: string, upstream: string): CaddyRoute {
  return {
    match: [{ host: [domain] }],
    handle: [
      {
        handler: "reverse_proxy",
        upstreams: [{ dial: upstream }],
      },
    ],
    terminal: true,
  };
}

function emptyConfig(): CaddyConfig {
  return {
    apps: {
      http: {
        servers: {
          srv0: {
            listen: [":443"],
            routes: [],
          },
        },
      },
    },
  };
}

async function getConfig(ssh: SSHConnectionOptions): Promise<CaddyConfig> {
  const { stdout } = await execOrFail(
    ssh,
    `${DOCKER_WGET} ${ADMIN_URL}/config/`
  );

  const trimmed = stdout.trim();
  if (!trimmed || trimmed === "null") return emptyConfig();

  return JSON.parse(trimmed) as CaddyConfig;
}

function ensureRoutes(config: CaddyConfig): CaddyRoute[] {
  if (!config.apps) config.apps = {};
  if (!config.apps.http) config.apps.http = {};
  if (!config.apps.http.servers) config.apps.http.servers = {};
  if (!config.apps.http.servers.srv0) {
    config.apps.http.servers.srv0 = { listen: [":443"], routes: [] };
  }
  if (!config.apps.http.servers.srv0.routes) {
    config.apps.http.servers.srv0.routes = [];
  }
  return config.apps.http.servers.srv0.routes;
}

function findRouteIndex(routes: CaddyRoute[], domain: string): number {
  return routes.findIndex(
    (r) => r.match?.[0]?.host?.[0] === domain
  );
}

async function putConfig(
  ssh: SSHConnectionOptions,
  config: CaddyConfig
): Promise<void> {
  const json = JSON.stringify(config);
  const escaped = json.replace(/'/g, "'\\''");
  await execOrFail(
    ssh,
    `${DOCKER_WGET} --header='Content-Type: application/json' --post-data='${escaped}' --method=PUT ${ADMIN_URL}/config/`
  );
}

/** Adds a reverse proxy route for a domain to the given upstream. */
export async function addRoute(
  ssh: SSHConnectionOptions,
  domain: string,
  upstream: string
): Promise<void> {
  const config = await getConfig(ssh);
  const routes = ensureRoutes(config);

  const existing = findRouteIndex(routes, domain);
  if (existing !== -1) {
    throw new Error(`Route for ${domain} already exists`);
  }

  routes.push(buildRoute(domain, upstream));
  await putConfig(ssh, config);
}

/** Deletes a reverse proxy route by domain. */
export async function deleteRoute(
  ssh: SSHConnectionOptions,
  domain: string
): Promise<void> {
  const config = await getConfig(ssh);
  const routes = ensureRoutes(config);

  const index = findRouteIndex(routes, domain);
  if (index === -1) {
    throw new Error(`No route found for ${domain}`);
  }

  routes.splice(index, 1);
  await putConfig(ssh, config);
}

/** Lists all configured reverse proxy routes. */
export async function listRoutes(
  ssh: SSHConnectionOptions
): Promise<Array<{ domain: string; upstream: string }>> {
  const config = await getConfig(ssh);
  const routes = config.apps?.http?.servers?.srv0?.routes ?? [];

  return routes
    .filter((r) => r.match?.[0]?.host?.[0] && r.handle?.[0]?.upstreams?.[0]?.dial)
    .map((r) => ({
      domain: r.match[0].host[0],
      upstream: r.handle[0].upstreams[0].dial,
    }));
}

/** Atomically updates the upstream for an existing route. */
export async function updateRouteUpstream(
  ssh: SSHConnectionOptions,
  domain: string,
  newUpstream: string
): Promise<void> {
  const config = await getConfig(ssh);
  const routes = ensureRoutes(config);

  const index = findRouteIndex(routes, domain);
  if (index === -1) {
    throw new Error(`No route found for ${domain}`);
  }

  routes[index] = buildRoute(domain, newUpstream);
  await putConfig(ssh, config);
}
