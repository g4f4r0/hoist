import net from "node:net";

import type { Provider, ServerInfo } from "../providers/index.js";
import { setupServer, checkHealth } from "./server-setup.js";
import { exec, closeConnection, clearKnownHost } from "./ssh.js";

export interface ProvisionOptions {
  provider: Provider;
  apiKey: string;
  name: string;
  type: string;
  region: string;
  sshKeyPublic: string;
  fallbackRegions?: string[];
  onProgress?: (msg: string) => void;
}

export interface ProvisionResult {
  server: ServerInfo;
  region: string;
}

/** Provisions a server through the full create-to-ready lifecycle. */
export async function provisionServer(opts: ProvisionOptions): Promise<ProvisionResult> {
  const { provider, apiKey, name, type, sshKeyPublic, onProgress } = opts;

  const regionsToTry = [opts.region, ...(opts.fallbackRegions ?? [])];
  let serverInfo: ServerInfo | undefined;
  let usedRegion = opts.region;
  let lastError: unknown;

  for (const tryRegion of regionsToTry) {
    try {
      onProgress?.(`Creating server in ${tryRegion}...`);
      serverInfo = await provider.createServer(apiKey, {
        name,
        type,
        region: tryRegion,
        sshKeyPublic,
      });
      usedRegion = tryRegion;
      break;
    } catch (err) {
      lastError = err;
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("resource_unavailable") || msg.includes("location disabled")) {
        onProgress?.(`Region ${tryRegion} unavailable, trying next...`);
        continue;
      }
      break;
    }
  }

  if (!serverInfo) {
    throw new Error(
      `Server creation failed: ${lastError instanceof Error ? lastError.message : String(lastError)}`
    );
  }

  const sshOpts = { host: serverInfo.ip, port: 22, username: "root" };
  clearKnownHost(serverInfo.ip);

  try {
    onProgress?.("Waiting for SSH...");
    await waitForSSH(sshOpts, onProgress);

    onProgress?.("Setting up server (Docker, firewall, Traefik)...");
    await setupServer(sshOpts, onProgress);

    onProgress?.("Running health check...");
    await checkHealth(sshOpts);
  } catch (err) {
    closeConnection(sshOpts);
    onProgress?.("Setup failed — destroying server...");
    try {
      await provider.deleteServer(apiKey, serverInfo.id);
    } catch (deleteErr) {
      onProgress?.(`Warning: failed to destroy server: ${deleteErr instanceof Error ? deleteErr.message : String(deleteErr)}`);
    }
    throw new Error(
      `Server setup failed: ${err instanceof Error ? err.message : String(err)}. Server destroyed.`
    );
  }

  closeConnection(sshOpts);
  return { server: serverInfo, region: usedRegion };
}

const SSH_MAX_RETRIES = 30;
const SSH_POLL_INTERVAL_MS = 5000;
const TCP_PROBE_TIMEOUT_MS = 3000;

async function waitForSSH(
  sshOpts: { host: string; port: number; username: string },
  onProgress?: (msg: string) => void
): Promise<void> {
  for (let attempt = 1; attempt <= SSH_MAX_RETRIES; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, SSH_POLL_INTERVAL_MS));
    onProgress?.(`Waiting for SSH (attempt ${attempt}/${SSH_MAX_RETRIES})...`);

    const portOpen = await probePort(sshOpts.host, sshOpts.port);
    if (!portOpen) continue;

    try {
      await exec(sshOpts, "echo ok");
      return;
    } catch {
      closeConnection(sshOpts);
    }
  }
  throw new Error(`SSH not reachable after ${SSH_MAX_RETRIES} attempts`);
}

function probePort(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(TCP_PROBE_TIMEOUT_MS);
    socket
      .once("connect", () => { socket.destroy(); resolve(true); })
      .once("timeout", () => { socket.destroy(); resolve(false); })
      .once("error", () => { socket.destroy(); resolve(false); })
      .connect(port, host);
  });
}
