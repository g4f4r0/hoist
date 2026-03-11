import fs from "node:fs";
import path from "node:path";

import { exec, execOrFail, type SSHConnectionOptions } from "./ssh.js";
import { uploadDirectory } from "./transfer.js";
import { addRoute, updateRouteUpstream } from "./caddy.js";
import type { AppServiceConfig, HealthCheckConfig } from "./project-config.js";

export interface DeployOptions {
  ssh: SSHConnectionOptions;
  serviceName: string;
  service: AppServiceConfig;
  sourceDir: string;
  onLog?: (msg: string) => void;
}

export interface DeployResult {
  service: string;
  server: string;
  status: "running" | "failed";
  image: string;
  url: string;
}

const HEALTH_CHECK_RETRIES = 10;
const HEALTH_CHECK_DELAY_MS = 3000;
const DEFAULT_WAIT_MS = 5000;

function containerName(serviceName: string): string {
  return `hoist-${serviceName}`;
}

function imageName(serviceName: string): string {
  return `hoist-${serviceName}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function isFirstDeploy(
  ssh: SSHConnectionOptions,
  serviceName: string
): Promise<boolean> {
  const result = await exec(
    ssh,
    `docker inspect ${containerName(serviceName)} --format '{{.State.Status}}' 2>/dev/null`
  );
  return result.code !== 0;
}

async function checkContainerHealth(
  ssh: SSHConnectionOptions,
  container: string,
  port: number,
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

function buildDockerRunArgs(
  serviceName: string,
  env: Record<string, string>,
  container?: string
): string {
  const name = container ?? containerName(serviceName);
  const parts = [
    "docker run -d",
    `--name ${name}`,
    "--network hoist",
    "--restart unless-stopped",
  ];

  for (const [key, value] of Object.entries(env)) {
    const escaped = value.replace(/'/g, "'\\''");
    parts.push(`-e '${key}=${escaped}'`);
  }

  parts.push(`${imageName(serviceName)}:latest`);

  return parts.join(" ");
}

/** Parses a .env file into key-value pairs, skipping comments and empty lines. */
export function loadEnvFile(filePath: string): Record<string, string> {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Env file not found: ${filePath}`);
  }

  const content = fs.readFileSync(filePath, "utf-8");
  const env: Record<string, string> = {};

  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;

    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    env[key] = value;
  }

  return env;
}

/** Deploys a service to a remote server with zero-downtime redeploy support. */
export async function deployService(opts: DeployOptions): Promise<DeployResult> {
  const { ssh, serviceName, service, sourceDir, onLog } = opts;
  const log = onLog ?? (() => {});
  const name = containerName(serviceName);
  const image = `${imageName(serviceName)}:latest`;
  const timestamp = Date.now();
  const buildDir = `/tmp/hoist-build-${serviceName}-${timestamp}`;
  const dockerfile = service.dockerfile ?? "Dockerfile";

  let env: Record<string, string> = {};
  if (service.env_file) {
    const envPath = path.resolve(sourceDir, service.env_file);
    log(`Loading env file: ${service.env_file}`);
    env = loadEnvFile(envPath);
  }

  log(`Uploading source to ${buildDir}`);
  await uploadDirectory(ssh, sourceDir, buildDir);

  log(`Building image ${image}`);
  await execOrFail(
    ssh,
    `docker build -t ${image} -f ${buildDir}/${dockerfile} ${buildDir}`,
    (data) => log(data)
  );

  const firstDeploy = await isFirstDeploy(ssh, serviceName);

  try {
    if (firstDeploy) {
      log("First deploy — starting container");
      const runCmd = buildDockerRunArgs(serviceName, env);
      await execOrFail(ssh, runCmd);

      log("Checking container health");
      await checkContainerHealth(ssh, name, service.port, service.healthCheck);

      if (service.domain) {
        log(`Configuring route: ${service.domain} → ${name}:${service.port}`);
        await addRoute(ssh, service.domain, `${name}:${service.port}`);
      }
    } else {
      log("Redeploying with zero-downtime swap");
      const newContainer = `${name}-new`;

      await exec(ssh, `docker rm -f ${newContainer} 2>/dev/null`);

      log(`Starting new container: ${newContainer}`);
      const runCmd = buildDockerRunArgs(serviceName, env, newContainer);
      await execOrFail(ssh, runCmd);

      log("Checking new container health");
      await checkContainerHealth(ssh, newContainer, service.port, service.healthCheck);

      if (service.domain) {
        log(`Swapping Caddy route to ${newContainer}:${service.port}`);
        await updateRouteUpstream(ssh, service.domain, `${newContainer}:${service.port}`);
      }

      log("Stopping old container");
      await execOrFail(ssh, `docker stop ${name}`);
      await execOrFail(ssh, `docker rm ${name}`);

      log("Renaming new container to live");
      await execOrFail(ssh, `docker rename ${newContainer} ${name}`);

      if (service.domain) {
        log(`Updating Caddy route to final name: ${name}:${service.port}`);
        await updateRouteUpstream(ssh, service.domain, `${name}:${service.port}`);
      }

      await exec(ssh, `docker tag ${image} ${imageName(serviceName)}:previous`);
    }
  } finally {
    log("Cleaning up build directory");
    await exec(ssh, `rm -rf ${buildDir}`);
  }

  const status = await exec(
    ssh,
    `docker inspect ${name} --format '{{.State.Status}}'`
  );
  const running = status.code === 0 && status.stdout.trim() === "running";

  const url = service.domain ? `https://${service.domain}` : `http://${ssh.host}:${service.port}`;

  return {
    service: serviceName,
    server: ssh.host,
    status: running ? "running" : "failed",
    image,
    url,
  };
}
