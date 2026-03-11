import { exec, type SSHConnectionOptions } from "./ssh.js";
import type { HealthCheckConfig } from "./project-config.js";

const HEALTH_CHECK_RETRIES = 10;
const HEALTH_CHECK_DELAY_MS = 3000;
const DEFAULT_WAIT_MS = 5000;

/** Returns the Docker container name for a service. */
export function containerName(serviceName: string): string {
  return `hoist-${serviceName}`;
}

/** Returns the Docker image name for a service. */
export function imageName(serviceName: string): string {
  return `hoist-${serviceName}`;
}

/** Returns a promise that resolves after the given milliseconds. */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Builds a docker run command string with env vars, volumes, and standard flags. */
export function buildDockerRunCmd(
  name: string,
  image: string,
  env: Record<string, string>,
  volumes?: Record<string, string>
): string {
  const parts = [
    "docker run -d",
    `--name ${name}`,
    "--network hoist",
    "--restart unless-stopped",
  ];

  if (volumes) {
    for (const [vol, mount] of Object.entries(volumes)) {
      const escapedVol = vol.replace(/'/g, "'\\''");
      const escapedMount = mount.replace(/'/g, "'\\''");
      parts.push(`-v '${escapedVol}:${escapedMount}'`);
    }
  }

  for (const [key, value] of Object.entries(env)) {
    const escaped = value.replace(/'/g, "'\\''");
    parts.push(`-e '${key}=${escaped}'`);
  }

  parts.push(image);

  return parts.join(" ");
}

/** Waits for a container to pass its health check or be running. */
export async function checkContainerHealth(
  ssh: SSHConnectionOptions,
  container: string,
  port?: number,
  healthCheck?: HealthCheckConfig
): Promise<void> {
  if (!healthCheck) {
    await sleep(DEFAULT_WAIT_MS);
    const result = await exec(
      ssh,
      `docker inspect ${container} --format '{{.State.Status}}'`
    );
    if (result.code !== 0 || result.stdout.trim() !== "running") {
      throw new Error(`Container ${container} is not running after startup`);
    }
    return;
  }

  if (port === undefined) {
    throw new Error(`Health check requires a port but none was configured for ${container}`);
  }

  const delayMs = healthCheck.interval ? healthCheck.interval * 1000 : HEALTH_CHECK_DELAY_MS;

  for (let i = 0; i < HEALTH_CHECK_RETRIES; i++) {
    await sleep(delayMs);
    const result = await exec(
      ssh,
      `docker exec ${container} wget -q -O- http://localhost:${port}${healthCheck.path}`
    );
    if (result.code === 0) return;
  }

  throw new Error(
    `Health check failed for ${container} after ${HEALTH_CHECK_RETRIES} attempts on :${port}${healthCheck.path}`
  );
}
