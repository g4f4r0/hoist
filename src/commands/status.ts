import { Command } from "commander";

import { loadProjectConfig, isAppService } from "../lib/project-config.js";
import { resolveServers } from "../lib/server-resolve.js";
import { listRoutes } from "../lib/traefik.js";
import { exec, closeConnection, type SSHConnectionOptions } from "../lib/ssh.js";
import { outputResult, outputError } from "../lib/output.js";

interface ContainerInfo {
  name: string;
  status: string;
  image: string;
  cpu?: string;
  memory?: string;
}

interface ServerStatus {
  name: string;
  provider: string;
  ip: string;
  disk: { size: string; used: string; avail: string; percent: string };
  status: string;
}

interface ServiceStatus {
  name: string;
  type: string;
  status: string;
  server: string;
  domain: string | null;
  image: string | null;
}

async function getContainers(ssh: SSHConnectionOptions): Promise<ContainerInfo[]> {
  const result = await exec(
    ssh,
    "docker ps --format '{{.Names}}\t{{.Status}}\t{{.Image}}'"
  );
  if (result.code !== 0 || !result.stdout.trim()) return [];

  const containers: ContainerInfo[] = result.stdout
    .trim()
    .split("\n")
    .map((line) => {
      const [name, status, image] = line.split("\t");
      return { name, status, image };
    });

  try {
    const stats = await exec(
      ssh,
      "docker stats --no-stream --format '{{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}'"
    );
    if (stats.code === 0 && stats.stdout.trim()) {
      const statMap = new Map<string, { cpu: string; memory: string }>();
      for (const line of stats.stdout.trim().split("\n")) {
        const [name, cpu, memory] = line.split("\t");
        statMap.set(name, { cpu, memory });
      }
      for (const container of containers) {
        const s = statMap.get(container.name);
        if (s) {
          container.cpu = s.cpu;
          container.memory = s.memory;
        }
      }
    }
  } catch {
    // Stats are optional, ignore failures
  }

  return containers;
}

async function getDisk(
  ssh: SSHConnectionOptions
): Promise<{ size: string; used: string; avail: string; percent: string }> {
  const result = await exec(ssh, "df -h / --output=size,used,avail,pcent | tail -1");
  if (result.code !== 0) {
    return { size: "?", used: "?", avail: "?", percent: "?" };
  }
  const parts = result.stdout.trim().split(/\s+/);
  return {
    size: parts[0] ?? "?",
    used: parts[1] ?? "?",
    avail: parts[2] ?? "?",
    percent: parts[3] ?? "?",
  };
}

export const statusCommand = new Command("status")
  .description("Show project status and drift detection")
  .action(async () => {
    let config;
    try {
      config = loadProjectConfig();
    } catch (err) {
      outputError(err instanceof Error ? err.message : "Failed to load project config");
      process.exit(1);
    }

    let resolved;
    try {
      resolved = await resolveServers(config.servers);
    } catch (err) {
      outputError(err instanceof Error ? err.message : "Failed to resolve servers");
      process.exit(1);
    }

    const serverStatuses: ServerStatus[] = [];
    const serviceStatuses: ServiceStatus[] = [];
    const drift: string[] = [];
    const allContainerNames = new Set<string>();
    const routesByServer = new Map<string, Array<{ appName: string; domain: string; upstream: string }>>();

    const seen = new Set<string>();

    for (const [serverName, info] of Object.entries(resolved)) {
      const ssh = { host: info.ip, port: 22, username: "root" };

      let containers: ContainerInfo[] = [];
      let disk = { size: "?", used: "?", avail: "?", percent: "?" };
      let routes: Array<{ appName: string; domain: string; upstream: string }> = [];
      let serverUp = true;

      if (!seen.has(info.ip)) {
        seen.add(info.ip);
        try {
          containers = await getContainers(ssh);
          disk = await getDisk(ssh);
          routes = await listRoutes(ssh);
        } catch {
          serverUp = false;
        }
        closeConnection(ssh);
      }

      for (const c of containers) {
        allContainerNames.add(c.name);
      }
      routesByServer.set(serverName, routes);

      serverStatuses.push({
        name: serverName,
        provider: info.provider,
        ip: info.ip,
        disk,
        status: serverUp ? "reachable" : "unreachable",
      });
    }

    for (const [serviceName, service] of Object.entries(config.services)) {
      const running = allContainerNames.has(serviceName);
      const routes = routesByServer.get(service.server) ?? [];
      const route = routes.find((r) => r.upstream.startsWith(serviceName));

      serviceStatuses.push({
        name: serviceName,
        type: service.type,
        status: running ? "running" : "stopped",
        server: service.server,
        domain: isAppService(service) ? (service.domain ?? route?.domain ?? null) : null,
        image: null,
      });

      if (!running) {
        drift.push(`service '${serviceName}' is defined but not running`);
      }
    }

    for (const cName of allContainerNames) {
      if (cName === "hoist-traefik") continue;
      if (!config.services[cName]) {
        drift.push(`container '${cName}' is running but not in config`);
      }
    }

    outputResult({
      project: config.project,
      servers: serverStatuses,
      services: serviceStatuses,
      drift,
    });
  });
