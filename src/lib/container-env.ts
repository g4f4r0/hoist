import { exec, execOrFail, type SSHConnectionOptions } from "./ssh.js";

export interface ContainerConfig {
  image: string;
  network: string;
  restart: string;
  volumes: string[];
  command: string[];
  labels: Record<string, string>;
}

const DOCKER_INTERNAL_VARS = new Set([
  "PATH",
  "HOME",
  "HOSTNAME",
  "TERM",
  "LANG",
  "LC_ALL",
  "GOPATH",
  "JAVA_HOME",
  "NODE_VERSION",
  "YARN_VERSION",
  "GPG_KEY",
  "PYTHON_VERSION",
]);

function containerName(serviceName: string): string {
  return `hoist-${serviceName}`;
}

/** Reads environment variables from a running container, filtering Docker internals. */
export async function listEnv(
  ssh: SSHConnectionOptions,
  serviceName: string
): Promise<Record<string, string>> {
  const name = containerName(serviceName);
  const result = await exec(
    ssh,
    `docker inspect --format '{{json .Config.Env}}' ${name}`
  );

  if (result.code !== 0) {
    throw new Error(`Container ${name} not found`);
  }

  const entries: string[] = JSON.parse(result.stdout.trim());
  const env: Record<string, string> = {};

  for (const entry of entries) {
    const eqIndex = entry.indexOf("=");
    if (eqIndex === -1) continue;
    const key = entry.slice(0, eqIndex);
    if (DOCKER_INTERNAL_VARS.has(key)) continue;
    env[key] = entry.slice(eqIndex + 1);
  }

  return env;
}

/** Reads the full container config needed to recreate it. */
export async function getContainerConfig(
  ssh: SSHConnectionOptions,
  serviceName: string
): Promise<ContainerConfig> {
  const name = containerName(serviceName);
  const { stdout } = await execOrFail(
    ssh,
    `docker inspect --format '{{json .}}' ${name}`
  );

  const info = JSON.parse(stdout.trim());

  const networks = info.NetworkSettings?.Networks ?? {};
  const networkKeys = Object.keys(networks);

  return {
    image: info.Config?.Image ?? "",
    network: networkKeys[0] ?? "hoist",
    restart: info.HostConfig?.RestartPolicy?.Name ?? "no",
    volumes: info.HostConfig?.Binds ?? [],
    command: info.Config?.Cmd ?? [],
    labels: info.Config?.Labels ?? {},
  };
}

/** Recreates a container with the same config but new environment variables. */
export async function recreateWithEnv(
  ssh: SSHConnectionOptions,
  serviceName: string,
  env: Record<string, string>
): Promise<void> {
  const name = containerName(serviceName);
  const config = await getContainerConfig(ssh, serviceName);

  await execOrFail(ssh, `docker stop ${name}`);
  await execOrFail(ssh, `docker rm ${name}`);

  const parts = [
    "docker run -d",
    `--name ${name}`,
    `--network ${config.network}`,
    `--restart ${config.restart}`,
  ];

  for (const volume of config.volumes) {
    parts.push(`-v '${volume}'`);
  }

  for (const [key, value] of Object.entries(config.labels)) {
    const escaped = value.replace(/'/g, "'\\''");
    parts.push(`--label '${key}=${escaped}'`);
  }

  for (const [key, value] of Object.entries(env)) {
    const escaped = value.replace(/'/g, "'\\''");
    parts.push(`-e '${key}=${escaped}'`);
  }

  parts.push(config.image);

  if (config.command.length > 0) {
    for (const arg of config.command) {
      const escaped = arg.replace(/'/g, "'\\''");
      parts.push(`'${escaped}'`);
    }
  }

  await execOrFail(ssh, parts.join(" "));

  const status = await exec(
    ssh,
    `docker inspect ${name} --format '{{.State.Status}}'`
  );

  if (status.code !== 0 || status.stdout.trim() !== "running") {
    throw new Error(`Container ${name} failed to start after recreation`);
  }
}

/** Parses KEY=VALUE strings from CLI arguments into a record. */
export function parseEnvArgs(args: string[]): Record<string, string> {
  const env: Record<string, string> = {};

  for (const arg of args) {
    const eqIndex = arg.indexOf("=");
    if (eqIndex === -1) {
      throw new Error(`Invalid env format: "${arg}" — expected KEY=VALUE`);
    }
    env[arg.slice(0, eqIndex)] = arg.slice(eqIndex + 1);
  }

  return env;
}
