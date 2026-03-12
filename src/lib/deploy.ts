import fs from "node:fs";
import path from "node:path";

import { exec, execOrFail, type SSHConnectionOptions } from "./ssh.js";
import { uploadDirectory } from "./transfer.js";
import { addRoute, updateRouteUpstream, generateAutoDomain } from "./traefik.js";
import { containerName, imageName, buildDockerRunCmd, checkContainerHealth } from "./container.js";
import type { AppServiceConfig } from "./project-config.js";

export interface DeployOptions {
  ssh: SSHConnectionOptions;
  serviceName: string;
  service: AppServiceConfig;
  sourceDir: string;
  repo?: string;
  branch?: string;
  onLog?: (msg: string) => void;
}

export interface DeployResult {
  service: string;
  server: string;
  status: "running" | "failed";
  image: string;
  url: string;
}

async function cloneRepository(
  ssh: SSHConnectionOptions,
  repo: string,
  branch: string,
  targetDir: string,
  onLog?: (msg: string) => void
): Promise<void> {
  const log = onLog ?? (() => {});
  log(`Cloning ${repo} (branch: ${branch})`);
  await execOrFail(ssh, `git clone --depth 1 --branch ${branch} ${repo} ${targetDir}`, (data) => log(data));
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

function buildRunCmd(
  serviceName: string,
  env: Record<string, string>,
  volumes?: Record<string, string>,
  container?: string
): string {
  const name = container ?? containerName(serviceName);
  return buildDockerRunCmd(name, `${imageName(serviceName)}:latest`, env, volumes);
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

  const domain = service.domain ?? generateAutoDomain(serviceName, ssh.host);

  let env: Record<string, string> = {};
  if (service.env_file) {
    const envPath = path.resolve(sourceDir, service.env_file);
    log(`Loading env file: ${service.env_file}`);
    env = loadEnvFile(envPath);
  }

  if (opts.repo) {
    await cloneRepository(ssh, opts.repo, opts.branch ?? "main", buildDir, onLog);
  } else {
    log(`Uploading source to ${buildDir}`);
    await uploadDirectory(ssh, sourceDir, buildDir);
  }

  const firstDeploy = await isFirstDeploy(ssh, serviceName);

  if (!firstDeploy) {
    await exec(ssh, `docker tag ${image} ${imageName(serviceName)}:previous`);
  }

  log(`Building image ${image}`);
  await execOrFail(
    ssh,
    `docker build -t ${image} -f ${buildDir}/${dockerfile} ${buildDir}`,
    (data) => log(data)
  );

  try {
    if (firstDeploy) {
      log("First deploy — starting container");
      const runCmd = buildRunCmd(serviceName, env, service.volumes);
      await execOrFail(ssh, runCmd);

      log("Checking container health");
      await checkContainerHealth(ssh, name, service.port, service.healthCheck);

      if (service.port) {
        log(`Configuring route: ${domain} → ${name}:${service.port}`);
        await addRoute(ssh, serviceName, domain, `${name}:${service.port}`);
      }
    } else {
      log("Redeploying with zero-downtime swap");
      const newContainer = `${name}-new`;

      await exec(ssh, `docker rm -f ${newContainer} 2>/dev/null`);

      log(`Starting new container: ${newContainer}`);
      const runCmd = buildRunCmd(serviceName, env, service.volumes, newContainer);
      await execOrFail(ssh, runCmd);

      log("Checking new container health");
      await checkContainerHealth(ssh, newContainer, service.port, service.healthCheck);

      if (service.port) {
        log(`Swapping route to ${newContainer}:${service.port}`);
        await updateRouteUpstream(ssh, serviceName, `${newContainer}:${service.port}`);
      }

      log("Stopping old container");
      await execOrFail(ssh, `docker stop ${name}`);
      await execOrFail(ssh, `docker rm ${name}`);

      log("Renaming new container to live");
      await execOrFail(ssh, `docker rename ${newContainer} ${name}`);

      if (service.port) {
        log(`Updating route to final name: ${name}:${service.port}`);
        await updateRouteUpstream(ssh, serviceName, `${name}:${service.port}`);
      }

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

  const url = `https://${domain}`;

  return {
    service: serviceName,
    server: ssh.host,
    status: running ? "running" : "failed",
    image,
    url,
  };
}
