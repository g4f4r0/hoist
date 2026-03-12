import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import ssh2 from "ssh2";
import { getKeysDir } from "./config.js";

const { Client } = ssh2;

export interface ExecResult {
  stdout: string;
  stderr: string;
  code: number;
}

export interface SSHConnectionOptions {
  host: string;
  port?: number;
  username?: string;
  privateKeyPath?: string;
}

const KNOWN_HOSTS_PATH = path.join(os.homedir(), ".hoist", "known_hosts");

function getKnownHosts(): Map<string, string> {
  if (!fs.existsSync(KNOWN_HOSTS_PATH)) return new Map();
  const lines = fs
    .readFileSync(KNOWN_HOSTS_PATH, "utf-8")
    .split("\n")
    .filter(Boolean);
  const map = new Map<string, string>();
  for (const line of lines) {
    const spaceIdx = line.indexOf(" ");
    if (spaceIdx === -1) continue;
    map.set(line.slice(0, spaceIdx), line.slice(spaceIdx + 1));
  }
  return map;
}

function updateKnownHosts(hosts: Map<string, string>): void {
  const lines = Array.from(hosts.entries()).map(
    ([host, fp]) => `${host} ${fp}`
  );
  fs.writeFileSync(KNOWN_HOSTS_PATH, lines.join("\n") + "\n", {
    mode: 0o600,
  });
}

/** Removes a host from the hoist known_hosts file so a new key can be accepted. */
export function clearKnownHost(host: string, port = 22): void {
  const hostId = `${host}:${port}`;
  const knownHosts = getKnownHosts();
  if (knownHosts.has(hostId)) {
    knownHosts.delete(hostId);
    updateKnownHosts(knownHosts);
  }
}

const pool = new Map<string, { client: InstanceType<typeof Client>; lastUsed: number }>();
const connecting = new Map<string, Promise<InstanceType<typeof Client>>>();

function poolKey(opts: SSHConnectionOptions): string {
  return `${opts.username ?? "root"}@${opts.host}:${opts.port ?? 22}`;
}

function createConnection(
  opts: SSHConnectionOptions
): Promise<InstanceType<typeof Client>> {
  const key = poolKey(opts);

  const existing = connecting.get(key);
  if (existing) return existing;

  const promise = new Promise<InstanceType<typeof Client>>(
    (resolve, reject) => {
      const conn = new Client();
      const keyPath =
        opts.privateKeyPath ?? path.join(getKeysDir(), "hoist_ed25519");

      conn
        .once("ready", () => {
          pool.set(key, { client: conn, lastUsed: Date.now() });
          connecting.delete(key);
          resolve(conn);
        })
        .once("error", (err: Error & { level?: string; code?: string }) => {
          connecting.delete(key);
          if (err.level === "client-authentication") {
            reject(new Error(`SSH authentication failed for ${opts.host}`));
          } else if (err.code === "ECONNREFUSED") {
            reject(
              new Error(`Connection refused by ${opts.host}:${opts.port ?? 22}`)
            );
          } else if (err.code === "ENOTFOUND") {
            reject(new Error(`Host not found: ${opts.host}`));
          } else if (err.code === "ETIMEDOUT") {
            reject(
              new Error(`Connection timed out for ${opts.host}:${opts.port ?? 22}`)
            );
          } else {
            reject(new Error(`SSH error (${opts.host}): ${err.message}`));
          }
        })
        .once("close", () => {
          pool.delete(key);
        })
        .connect({
          host: opts.host,
          port: opts.port ?? 22,
          username: opts.username ?? "root",
          privateKey: fs.readFileSync(keyPath),
          readyTimeout: 20000,
          keepaliveInterval: 10000,
          keepaliveCountMax: 3,
          hostHash: "sha256",
          hostVerifier: (hashedKey: Buffer) => {
            const fingerprint = hashedKey.toString("hex");
            const hostId = `${opts.host}:${opts.port ?? 22}`;
            const knownHosts = getKnownHosts();
            const known = knownHosts.get(hostId);

            if (!known) {
              knownHosts.set(hostId, fingerprint);
              updateKnownHosts(knownHosts);
              return true;
            }
            if (known === fingerprint) return true;

            return false;
          },
        });
    }
  );

  connecting.set(key, promise);
  return promise;
}

/** Returns a pooled SSH connection, creating one if needed. */
export async function getConnection(
  opts: SSHConnectionOptions
): Promise<InstanceType<typeof Client>> {
  const key = poolKey(opts);
  const cached = pool.get(key);
  if (cached) {
    cached.lastUsed = Date.now();
    return cached.client;
  }
  return createConnection(opts);
}

/** Executes a command over SSH and returns stdout, stderr, and exit code. */
export async function exec(
  opts: SSHConnectionOptions,
  command: string,
  onData?: (data: string) => void
): Promise<ExecResult> {
  const conn = await getConnection(opts);
  return new Promise((resolve, reject) => {
    conn.exec(command, (err, stream) => {
      if (err) {
        reject(new Error(`Failed to execute command: ${err.message}`));
        return;
      }

      let stdout = "";
      let stderr = "";

      stream
        .on("close", (code: number) => {
          resolve({ stdout, stderr, code: code ?? 0 });
        })
        .on("data", (data: Buffer) => {
          const str = data.toString();
          stdout += str;
          onData?.(str);
        })
        .stderr.on("data", (data: Buffer) => {
          const str = data.toString();
          stderr += str;
          onData?.(str);
        });
    });
  });
}

/** Executes a command over SSH and throws if the exit code is non-zero. */
export async function execOrFail(
  opts: SSHConnectionOptions,
  command: string,
  onData?: (data: string) => void
): Promise<{ stdout: string; stderr: string }> {
  const result = await exec(opts, command, onData);
  if (result.code !== 0) {
    throw new Error(
      `Command failed (exit ${result.code}): ${result.stderr || result.stdout}`
    );
  }
  return { stdout: result.stdout, stderr: result.stderr };
}

/** Closes a specific connection and deletes it from the pool. */
export function closeConnection(opts: SSHConnectionOptions): void {
  const key = poolKey(opts);
  const cached = pool.get(key);
  if (cached) {
    cached.client.end();
    pool.delete(key);
  }
}

/** Closes all connections and clears the pool. */
export function closeAll(): void {
  for (const [key, { client }] of pool) {
    client.end();
    pool.delete(key);
  }
}
