import { exec, execOrFail, type SSHConnectionOptions } from "./ssh.js";
import { resolveTemplate } from "./template.js";
import { getTemplate } from "./templates/index.js";

export interface DatabaseCreateOptions {
  ssh: SSHConnectionOptions;
  serviceName: string;
  templateName: string;
  version?: string;
  public?: boolean;
  onLog?: (msg: string) => void;
}

export interface DatabaseInfo {
  service: string;
  type: string;
  version: string;
  status: string;
  connectionString: string;
  publicConnectionString: string;
  container: string;
  port: number;
  public: boolean;
}

/** Formats an SSH tunnel command for external access to a database container. */
export function formatSshTunnel(host: string, container: string, port: number): string {
  return `ssh -L ${port}:${container}:${port} root@${host} -N`;
}

const HEALTH_CHECK_RETRIES = 10;
const HEALTH_CHECK_DELAY_MS = 3000;

function containerName(serviceName: string): string {
  return serviceName;
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

  const isPublic = opts.public ?? false;

  const parts = [
    "docker run -d",
    `--name ${container}`,
    "--network hoist",
    "--restart unless-stopped",
  ];

  if (isPublic) {
    parts.push(`-p ${resolved.port}:${resolved.port}`);
  }

  for (const [mountPath, volumeName] of Object.entries(resolved.volumes)) {
    parts.push(`-v ${volumeName}:${mountPath}`);
  }

  for (const [key, value] of Object.entries(resolved.env)) {
    const escaped = value.replace(/'/g, "'\\''");
    parts.push(`-e '${key}=${escaped}'`);
  }

  parts.push(`--label hoist.managed=true`);
  parts.push(`--label hoist.type=database`);
  parts.push(`--label hoist.template=${templateName}`);
  parts.push(`--label hoist.version=${version ?? template.defaultVersion}`);
  parts.push(`--label hoist.service=${serviceName}`);
  parts.push(`--label hoist.port=${resolved.port}`);
  parts.push(`--label hoist.public=${isPublic}`);
  parts.push(`--label 'hoist.connection=${resolved.connectionString}'`);

  parts.push(resolved.image);

  if (resolved.command) {
    parts.push(resolved.command);
  }

  log(`Starting database container: ${container}`);
  await execOrFail(ssh, parts.join(" "));

  if (isPublic) {
    log(`Opening firewall port ${resolved.port}`);
    await exec(ssh, `ufw allow ${resolved.port}/tcp`);
  }

  if (resolved.healthCheck) {
    log("Waiting for database to be ready");
    await waitForHealthy(ssh, container, resolved.healthCheck);
  }

  const publicConnectionString = isPublic
    ? resolved.connectionString.replace(`${container}:${resolved.port}`, `${ssh.host}:${resolved.port}`)
    : "";

  return {
    service: serviceName,
    type: templateName,
    version: version ?? template.defaultVersion,
    status: "running",
    connectionString: resolved.connectionString,
    publicConnectionString,
    container,
    port: resolved.port,
    public: isPublic,
  };
}

/** Lists all database containers managed by hoist. */
export async function listDatabases(
  ssh: SSHConnectionOptions
): Promise<DatabaseInfo[]> {
  const format =
    '{{.Names}}\t{{.Status}}\t{{.Label "hoist.template"}}\t{{.Label "hoist.version"}}\t{{.Label "hoist.service"}}\t{{.Label "hoist.connection"}}\t{{.Label "hoist.port"}}\t{{.Label "hoist.public"}}';
  const result = await exec(
    ssh,
    `docker ps -a --filter label=hoist.type=database --format '${format}'`
  );

  if (result.code !== 0 || !result.stdout.trim()) {
    return [];
  }

  return result.stdout
    .trim()
    .split("\n")
    .map((line) => {
      const [container, status, type, version, service, connectionString, portStr, publicStr] =
        line.split("\t");
      const isPublic = publicStr === "true";
      const publicConnectionString = isPublic && ssh.host
        ? connectionString.replace(`${container}:${portStr}`, `${ssh.host}:${portStr}`)
        : "";
      return { service, type, version, status, connectionString, publicConnectionString, container, port: parseInt(portStr, 10) || 0, public: isPublic };
    });
}

/** Deletes a database container and optionally its volumes. */
export async function deleteDatabase(
  ssh: SSHConnectionOptions,
  serviceName: string,
  deleteVolumes?: boolean
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

  if (deleteVolumes) {
    const volumes = await exec(
      ssh,
      `docker volume ls --filter name=${serviceName}- --format '{{.Name}}'`
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
    '{{index .Config.Labels "hoist.port"}}',
    '{{index .Config.Labels "hoist.public"}}',
  ].join("\t");

  const result = await exec(
    ssh,
    `docker inspect ${container} --format '${format}'`
  );
  if (result.code !== 0) {
    throw new Error(`Database container ${container} not found`);
  }

  const [status, type, version, service, connectionString, portStr, publicStr] = result.stdout
    .trim()
    .split("\t");

  const isPublic = publicStr === "true";
  const publicConnectionString = isPublic
    ? connectionString.replace(`${container}:${portStr}`, `${ssh.host}:${portStr}`)
    : "";

  return { service, type, version, status, connectionString, publicConnectionString, container, port: parseInt(portStr, 10) || 0, public: isPublic };
}

/** Toggles public access on a database container by recreating it with or without port mapping. */
export async function setDatabasePublic(
  ssh: SSHConnectionOptions,
  serviceName: string,
  makePublic: boolean,
  onLog?: (msg: string) => void
): Promise<DatabaseInfo> {
  const log = onLog ?? (() => {});
  const container = containerName(serviceName);

  const info = await getDatabaseInfo(ssh, serviceName);
  if (info.public === makePublic) {
    return info;
  }

  log(`Reading container config`);
  const inspect = await execOrFail(ssh, `docker inspect ${container}`);
  const containerConfig = JSON.parse(inspect.stdout.trim())[0];

  const image = containerConfig.Config.Image as string;
  const envArr = (containerConfig.Config.Env ?? []) as string[];
  const labels = (containerConfig.Config.Labels ?? {}) as Record<string, string>;
  const mounts = (containerConfig.Mounts ?? []) as Array<{ Destination: string; Name: string }>;
  const cmd = (containerConfig.Config.Cmd ?? []) as string[];

  const template = labels["hoist.template"];
  const version = labels["hoist.version"];
  const service = labels["hoist.service"];
  const connectionString = labels["hoist.connection"];
  const port = parseInt(labels["hoist.port"], 10);

  log(`Stopping container`);
  await exec(ssh, `docker stop ${container}`);
  await execOrFail(ssh, `docker rm ${container}`);

  const parts = [
    "docker run -d",
    `--name ${container}`,
    "--network hoist",
    "--restart unless-stopped",
  ];

  if (makePublic) {
    parts.push(`-p ${port}:${port}`);
  }

  for (const mount of mounts) {
    if (mount.Name && mount.Destination) {
      parts.push(`-v ${mount.Name}:${mount.Destination}`);
    }
  }

  for (const envPair of envArr) {
    const escaped = envPair.replace(/'/g, "'\\''");
    parts.push(`-e '${escaped}'`);
  }

  parts.push(`--label hoist.managed=true`);
  parts.push(`--label hoist.type=database`);
  parts.push(`--label hoist.template=${template}`);
  parts.push(`--label hoist.version=${version}`);
  parts.push(`--label hoist.service=${service}`);
  parts.push(`--label hoist.port=${port}`);
  parts.push(`--label hoist.public=${makePublic}`);
  parts.push(`--label 'hoist.connection=${connectionString}'`);
  parts.push(image);

  if (cmd.length > 0) {
    parts.push(cmd.join(" "));
  }

  log(`Recreating container ${makePublic ? "with" : "without"} public access`);
  await execOrFail(ssh, parts.join(" "));

  if (makePublic) {
    log(`Opening firewall port ${port}`);
    await exec(ssh, `ufw allow ${port}/tcp`);
  } else {
    log(`Closing firewall port ${port}`);
    await exec(ssh, `ufw deny ${port}/tcp`);
  }

  const publicConnectionString = makePublic
    ? connectionString.replace(`${container}:${port}`, `${ssh.host}:${port}`)
    : "";

  return {
    service,
    type: template,
    version,
    status: "running",
    connectionString,
    publicConnectionString,
    container,
    port,
    public: makePublic,
  };
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
