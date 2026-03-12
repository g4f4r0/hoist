import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { Command } from "commander";
import ssh2 from "ssh2";

import { getConfig, hasConfig } from "../lib/config.js";
import {
  hasKeys,
  readPublicKey,
  getPublicKeyPath,
  getPrivateKeyPath,
} from "../lib/ssh-keys.js";
import { getProvider, type ServerInfo } from "../providers/index.js";
import { exec, closeConnection } from "../lib/ssh.js";
import { outputResult, outputError, outputProgress } from "../lib/output.js";

const { utils } = ssh2;

function hasSetup(): boolean {
  return hasConfig() && hasKeys();
}

function getFingerprint(publicKey: string): string {
  const parsed = utils.parseKey(publicKey);
  if (parsed instanceof Error || !parsed) {
    throw new Error("Failed to parse public key");
  }
  const key = Array.isArray(parsed) ? parsed[0] : parsed;
  const sha = crypto
    .createHash("sha256")
    .update(key.getPublicSSH())
    .digest("base64")
    .replace(/=+$/, "");
  return `SHA256:${sha}`;
}

export const keysCommand = new Command("keys").description(
  "Manage SSH keys"
);

keysCommand
  .command("show")
  .description("Show current public key path and fingerprint")
  .action(async () => {
    if (!hasKeys()) {
      outputError("No SSH keys found. Run 'hoist init' first.", undefined, { actor: "agent", action: "Run hoist init to set up.", command: "hoist init" });
      process.exit(1);
    }

    const publicKeyPath = getPublicKeyPath();
    const publicKey = readPublicKey();
    const fingerprint = getFingerprint(publicKey);

    outputResult({
      publicKeyPath,
      fingerprint,
      publicKey,
    });
  });

keysCommand
  .command("rotate")
  .description("Generate a new key pair and update all managed servers")
  .option("--confirm", "Confirm destructive action")
  .action(async (opts: { confirm?: boolean }) => {
    if (!hasSetup()) {
      outputError("Run 'hoist init' first.", undefined, { actor: "agent", action: "Run hoist init to set up.", command: "hoist init" });
      process.exit(1);
    }

    if (!opts.confirm) {
      outputError(
        "Destructive action: this will rotate SSH keys across all managed servers. Re-run with --confirm to proceed.",
        undefined,
        { actor: "agent", action: "Re-run with --confirm if the user approves.", command: "hoist keys rotate --confirm" }
      );
      process.exit(1);
    }

    const config = getConfig();
    const labels = Object.keys(config.providers);

    if (labels.length === 0) {
      outputError("No providers configured. Run 'hoist provider add' first.", undefined, { actor: "agent", action: "Add a provider first.", command: "hoist provider add --type hetzner" });
      process.exit(1);
    }

    const allServers: Array<ServerInfo & { provider: string }> = [];

    outputProgress("keys", "Fetching servers from all providers");

    for (const name of labels) {
      const providerConfig = config.providers[name];
      if (!providerConfig) continue;
      const provider = getProvider(providerConfig.type);
      try {
        const servers = await provider.listServers(providerConfig.apiKey);
        for (const server of servers) {
          allServers.push({ ...server, provider: name });
        }
      } catch {
        // Skip providers that fail
      }
    }

    const serversWithIp = allServers.filter((s) => s.ip);

    if (serversWithIp.length === 0) {
      outputError("No servers with IP addresses found.");
      process.exit(1);
    }

    const oldPublicKey = readPublicKey();

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hoist-keys-"));
    const tmpPrivatePath = path.join(tmpDir, "hoist_ed25519");
    const tmpPublicPath = path.join(tmpDir, "hoist_ed25519.pub");

    outputProgress("keys", "Generating new key pair");

    const newKeys = utils.generateKeyPairSync("ed25519", { comment: "hoist" });
    fs.writeFileSync(tmpPrivatePath, newKeys.private, { mode: 0o600 });
    fs.writeFileSync(tmpPublicPath, newKeys.public, { mode: 0o644 });

    const newPublicKey = newKeys.public.trim();

    const results: Array<{
      server: string;
      ip: string;
      status: "ok" | "failed";
      error?: string;
    }> = [];

    for (const server of serversWithIp) {
      outputProgress("keys", `Updating key on ${server.name} (${server.ip})`);

      const sshOpts = { host: server.ip, port: 22, username: "root" };

      try {
        const escapedNew = newPublicKey.replace(/'/g, "'\\''");
        const escapedOld = oldPublicKey.replace(/'/g, "'\\''");

        const addResult = await exec(
          sshOpts,
          `mkdir -p ~/.ssh && echo '${escapedNew}' >> ~/.ssh/authorized_keys`
        );
        if (addResult.code !== 0) {
          throw new Error(
            `Failed to add new key: ${addResult.stderr || addResult.stdout}`
          );
        }

        const removeResult = await exec(
          sshOpts,
          `grep -vF '${escapedOld}' ~/.ssh/authorized_keys > ~/.ssh/authorized_keys.tmp && mv ~/.ssh/authorized_keys.tmp ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys`
        );
        if (removeResult.code !== 0) {
          throw new Error(
            `Failed to remove old key: ${removeResult.stderr || removeResult.stdout}`
          );
        }

        results.push({ server: server.name, ip: server.ip, status: "ok" });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        results.push({
          server: server.name,
          ip: server.ip,
          status: "failed",
          error: message,
        });
      } finally {
        closeConnection(sshOpts);
      }
    }

    const failed = results.filter((r) => r.status === "failed");

    if (failed.length > 0) {
      outputResult({
        status: "partial",
        message: `${failed.length} server(s) failed to update`,
        tmpDir,
        results,
      });
      process.exit(1);
    }

    fs.copyFileSync(tmpPrivatePath, getPrivateKeyPath());
    fs.chmodSync(getPrivateKeyPath(), 0o600);
    fs.copyFileSync(tmpPublicPath, getPublicKeyPath());
    fs.chmodSync(getPublicKeyPath(), 0o644);

    fs.rmSync(tmpDir, { recursive: true, force: true });

    outputResult({
      status: "success",
      message: "Keys rotated successfully",
      serversUpdated: results.length,
      results,
    });
  });
