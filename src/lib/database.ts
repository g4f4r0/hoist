import { exec, execOrFail, type SSHConnectionOptions } from "./ssh.js";
import { resolveTemplate, type ResolvedTemplate } from "./template.js";
import { getTemplate } from "./templates/index.js";

export interface DatabaseCreateOptions {
  ssh: SSHConnectionOptions;
  serviceName: string;
  templateName: string;
  version?: string;
  onLog?: (msg: string) => void;
}

export interface DatabaseInfo {
  service: string;
  type: string;
  version: string;
  status: string;
  connectionString: string;
  container: string;
}

const HEALTH_CHECK_RETRIES = 10;
const HEALTH_CHECK_DELAY_MS = 3000;

function containerName(serviceName: string): string {
  return `hoist-${serviceName}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForHealthy(
  ssh: SSHConnectionOptions,
  container: string,
  healthCheck: string
): Promise<void> {
  for (let i = 0; i < HEALTH_CHECK_RETRIES; i++) {
    await sleep(HEALTH_CHECK_DELAY_MS);
    const result = await exec(ssh, `docker exec ${container} ${healthCheck}`);
    if (result.code === 0) return;
  }

  throw new Error(
    `Health check failed for ${container} after ${HEALTH_CHECK_RETRIES} attempts`
  );
}

/** Creates a database container from a template and returns its connection info. */
export async function createDatabase(
  opts: DatabaseCreateOptions
): Promise<DatabaseInfo> {
  const { ssh, serviceName, templateName, version, onLog } = opts;
  const log = onLog ?? (() => {});
  const container = containerName(serviceName);

  const template = getTemplate(templateName);
  const resolved = resolveTemplate(template, serviceName, version);

  log(`Checking for existing container: ${container}`);
  const existing = await exec(
    ssh,
    `docker inspect ${container} --format '{{.State.Status}}' 2>/dev/null`
  );
  if (existing.code === 0) {
    throw new Error(`Container ${container} already exists`);
  }

  for (const volumeName of Object.values(resolved.volumes)) {
    log(`Creating volume: ${volumeName}`);
    await execOrFail(ssh, `docker volume create ${volumeName}`);
  }

  const parts = [
    "docker run -d",
    `--name ${container}`,
    "--network hoist",
    "--restart unless-stopped",
  ];

  for (const [mountPath, volumeName] of Object.entries(resolved.volumes)) {
    parts.push(`-v ${volumeName}:${mountPath}`);
  }

  for (const [key, value] of Object.entries(resolved.env)) {
    const escaped = value.replace(/'/g, "'\\''");
    parts.push(`-e '${key}=${escaped}'`);
  }

  parts.push(`--label hoist.managed=true`);
  parts.push(`--label hoist.kind=database`);
  parts.push(`--label hoist.template=${templateName}`);
  parts.push(`--label hoist.version=${version ?? template.defaultVersion}`);
  parts.push(`--label hoist.service=${serviceName}`);
  parts.push(`--label 'hoist.connection=${resolved.connectionString}'`);

  parts.push(resolved.image);

  if (resolved.command) {
    parts.push(resolved.command);
  }

  log(`Starting database container: ${container}`);
  await execOrFail(ssh, parts.join(" "));

  if (resolved.healthCheck) {
    log("Waiting for database to be ready");
    await waitForHealthy(ssh, container, resolved.healthCheck);
  }

  return {
    service: serviceName,
    type: templateName,
    version: version ?? template.defaultVersion,
    status: "running",
    connectionString: resolved.connectionString,
    container,
  };
}

/** Lists all database containers managed by hoist. */
export async function listDatabases(
  ssh: SSHConnectionOptions
): Promise<DatabaseInfo[]> {
  const format =
    '{{.Names}}\t{{.Status}}\t{{.Label "hoist.template"}}\t{{.Label "hoist.version"}}\t{{.Label "hoist.service"}}\t{{.Label "hoist.connection"}}';
  const result = await exec(
    ssh,
    `docker ps -a --filter label=hoist.kind=database --format '${format}'`
  );

  if (result.code !== 0 || !result.stdout.trim()) {
    return [];
  }

  return result.stdout
    .trim()
    .split("\n")
    .map((line) => {
      const [container, status, type, version, service, connectionString] =
        line.split("\t");
      return { service, type, version, status, connectionString, container };
    });
}

/** Removes a database container and optionally its volumes. */
export async function removeDatabase(
  ssh: SSHConnectionOptions,
  serviceName: string,
  removeVolumes?: boolean
): Promise<void> {
  const container = containerName(serviceName);

  const inspect = await exec(
    ssh,
    `docker inspect ${container} --format '{{.State.Status}}' 2>/dev/null`
  );
  if (inspect.code !== 0) {
    throw new Error(`Database container ${container} not found`);
  }

  await exec(ssh, `docker stop ${container}`);
  await execOrFail(ssh, `docker rm ${container}`);

  if (removeVolumes) {
    const volumes = await exec(
      ssh,
      `docker volume ls --filter name=hoist-${serviceName}- --format '{{.Name}}'`
    );
    if (volumes.code === 0 && volumes.stdout.trim()) {
      for (const name of volumes.stdout.trim().split("\n")) {
        await execOrFail(ssh, `docker volume rm ${name}`);
      }
    }
  }
}

/** Returns info for a single database container by service name. */
export async function getDatabaseInfo(
  ssh: SSHConnectionOptions,
  serviceName: string
): Promise<DatabaseInfo> {
  const container = containerName(serviceName);

  const format = [
    '{{.State.Status}}',
    '{{index .Config.Labels "hoist.template"}}',
    '{{index .Config.Labels "hoist.version"}}',
    '{{index .Config.Labels "hoist.service"}}',
    '{{index .Config.Labels "hoist.connection"}}',
  ].join("\t");

  const result = await exec(
    ssh,
    `docker inspect ${container} --format '${format}'`
  );
  if (result.code !== 0) {
    throw new Error(`Database container ${container} not found`);
  }

  const [status, type, version, service, connectionString] = result.stdout
    .trim()
    .split("\t");

  return { service, type, version, status, connectionString, container };
}

/** Starts, stops, or restarts a database container. */
export async function controlDatabase(
  ssh: SSHConnectionOptions,
  serviceName: string,
  action: "start" | "stop" | "restart"
): Promise<void> {
  const container = containerName(serviceName);
  await execOrFail(ssh, `docker ${action} ${container}`);
}
