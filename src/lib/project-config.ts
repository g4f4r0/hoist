import fs from "node:fs";
import path from "node:path";

const PROJECT_CONFIG_FILE = "hoist.json";

const DATABASE_TYPES = ["postgres", "mysql", "mariadb", "redis", "mongodb"] as const;

type DatabaseType = (typeof DATABASE_TYPES)[number];

export interface HealthCheckConfig {
  path: string;
  interval?: number;
  timeout?: number;
}

export interface AutodeployConfig {
  enabled: boolean;
  branch?: string;
  provider?: string;
}

export interface AppServiceConfig {
  server: string;
  type: "app";
  source: string;
  dockerfile?: string;
  port?: number;
  domain?: string;
  env_file?: string;
  volumes?: Record<string, string>;
  autodeploy?: AutodeployConfig;
  healthCheck?: HealthCheckConfig;
}

export interface DatabaseServiceConfig {
  server: string;
  type: DatabaseType;
  version: string;
}

export type ServiceConfig = AppServiceConfig | DatabaseServiceConfig;

export interface ServerConfig {
  provider: string;
}

export interface ProjectConfig {
  project: string;
  servers: Record<string, ServerConfig>;
  services: Record<string, ServiceConfig>;
}

/** Returns true if the service is an app service. */
export function isAppService(service: ServiceConfig): service is AppServiceConfig {
  return service.type === "app";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(obj: Record<string, unknown>, field: string, context: string): string {
  const value = obj[field];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${context}: "${field}" must be a non-empty string`);
  }
  return value;
}

function requireNumber(obj: Record<string, unknown>, field: string, context: string): number {
  const value = obj[field];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${context}: "${field}" must be a number`);
  }
  return value;
}

function optionalString(obj: Record<string, unknown>, field: string, context: string): string | undefined {
  const value = obj[field];
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new Error(`${context}: "${field}" must be a string`);
  }
  return value;
}

function optionalNumber(obj: Record<string, unknown>, field: string, context: string): number | undefined {
  const value = obj[field];
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${context}: "${field}" must be a number`);
  }
  return value;
}

function validateHealthCheck(raw: unknown, context: string): HealthCheckConfig {
  if (!isRecord(raw)) {
    throw new Error(`${context}: healthCheck must be an object`);
  }
  return {
    path: requireString(raw, "path", context),
    interval: optionalNumber(raw, "interval", context),
    timeout: optionalNumber(raw, "timeout", context),
  };
}

function validateAutodeploy(raw: unknown, context: string): AutodeployConfig {
  if (!isRecord(raw)) {
    throw new Error(`${context}: autodeploy must be an object`);
  }
  const enabled = raw.enabled;
  if (typeof enabled !== "boolean") {
    throw new Error(`${context}: autodeploy "enabled" must be a boolean`);
  }
  return {
    enabled,
    branch: optionalString(raw, "branch", context),
    provider: optionalString(raw, "provider", context),
  };
}

function validateServer(raw: unknown, name: string): ServerConfig {
  const ctx = `server "${name}"`;
  if (!isRecord(raw)) {
    throw new Error(`${ctx}: must be an object`);
  }
  return {
    provider: requireString(raw, "provider", ctx),
  };
}

function validateService(raw: unknown, name: string, serverNames: string[]): ServiceConfig {
  const ctx = `service "${name}"`;
  if (!isRecord(raw)) {
    throw new Error(`${ctx}: must be an object`);
  }

  const server = requireString(raw, "server", ctx);
  if (!serverNames.includes(server)) {
    throw new Error(`${ctx}: references unknown server "${server}"`);
  }

  const type = requireString(raw, "type", ctx);

  if (type === "app") {
    const port = optionalNumber(raw, "port", ctx);
    const domain = optionalString(raw, "domain", ctx);

    if (domain && port === undefined) {
      throw new Error(`${ctx}: "port" is required when "domain" is set`);
    }
    if (raw.healthCheck !== undefined && port === undefined) {
      throw new Error(`${ctx}: "port" is required when "healthCheck" is set`);
    }

    const service: AppServiceConfig = {
      server,
      type: "app",
      source: requireString(raw, "source", ctx),
      dockerfile: optionalString(raw, "dockerfile", ctx),
      port,
      domain,
      env_file: optionalString(raw, "env_file", ctx),
    };

    if (isRecord(raw.volumes)) {
      const volumes: Record<string, string> = {};
      for (const [vol, mount] of Object.entries(raw.volumes)) {
        if (typeof mount !== "string" || mount.length === 0) {
          throw new Error(`${ctx}: volume "${vol}" mount path must be a non-empty string`);
        }
        volumes[vol] = mount;
      }
      service.volumes = volumes;
    }

    if (raw.autodeploy !== undefined) {
      service.autodeploy = validateAutodeploy(raw.autodeploy, ctx);
    }
    if (raw.healthCheck !== undefined) {
      service.healthCheck = validateHealthCheck(raw.healthCheck, ctx);
    }
    return service;
  }

  if (!(DATABASE_TYPES as readonly string[]).includes(type)) {
    throw new Error(`${ctx}: unknown type "${type}", expected "app" or one of ${DATABASE_TYPES.join(", ")}`);
  }

  return {
    server,
    type: type as DatabaseType,
    version: requireString(raw, "version", ctx),
  };
}

/** Validates an unknown value as a ProjectConfig and returns the typed result. */
export function validateProjectConfig(config: unknown): ProjectConfig {
  if (!isRecord(config)) {
    throw new Error("hoist.json must be a JSON object");
  }

  const project = requireString(config, "project", "hoist.json");

  if (!isRecord(config.servers)) {
    throw new Error('hoist.json: "servers" must be an object');
  }
  const serverEntries = Object.entries(config.servers);
  if (serverEntries.length === 0) {
    throw new Error('hoist.json: "servers" must define at least one server');
  }
  const servers: Record<string, ServerConfig> = {};
  for (const [name, raw] of serverEntries) {
    servers[name] = validateServer(raw, name);
  }

  if (!isRecord(config.services)) {
    throw new Error('hoist.json: "services" must be an object');
  }
  const serverNames = Object.keys(servers);
  const services: Record<string, ServiceConfig> = {};
  for (const [name, raw] of Object.entries(config.services)) {
    services[name] = validateService(raw, name, serverNames);
  }

  return { project, servers, services };
}

/** Reads and validates hoist.json from the given directory. */
export function loadProjectConfig(dir?: string): ProjectConfig {
  const base = dir ?? process.cwd();
  const filePath = path.join(base, PROJECT_CONFIG_FILE);

  if (!fs.existsSync(filePath)) {
    throw new Error(`No ${PROJECT_CONFIG_FILE} found in ${base}`);
  }

  let raw: unknown;
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    raw = JSON.parse(content);
  } catch (err) {
    if (err instanceof SyntaxError) {
      throw new Error(`Invalid JSON in ${filePath}: ${err.message}`);
    }
    throw err;
  }

  return validateProjectConfig(raw);
}

/** Returns the single server name from config, or throws if ambiguous. */
export function getDefaultServer(config: ProjectConfig, specified?: string): string {
  if (specified) return specified;
  const names = Object.keys(config.servers);
  if (names.length === 1) return names[0];
  throw new Error("Multiple servers in config. Use --server to specify one.");
}

/** Returns the services assigned to a specific server. */
export function listServicesByServer(config: ProjectConfig, serverName: string): Record<string, ServiceConfig> {
  const result: Record<string, ServiceConfig> = {};
  for (const [name, service] of Object.entries(config.services)) {
    if (service.server === serverName) {
      result[name] = service;
    }
  }
  return result;
}
