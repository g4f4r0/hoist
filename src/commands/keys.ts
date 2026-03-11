import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { Command } from "commander";
import * as p from "@clack/prompts";
import chalk from "chalk";
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
import { outputJson, outputError, outputSuccess } from "../lib/output.js";

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
  .option("--json", "Output as JSON")
  .action(async (opts: { json?: boolean }) => {
    if (!hasKeys()) {
      outputError("No SSH keys found. Run 'hoist init' first.");
      process.exit(1);
    }

    const publicKeyPath = getPublicKeyPath();
    const publicKey = readPublicKey();
    const fingerprint = getFingerprint(publicKey);

    const result = {
      publicKeyPath,
      fingerprint,
      publicKey,
    };

    if (opts.json) {
      outputJson(result);
      return;
    }

    p.log.info(`${chalk.bold("Public key:")}   ${publicKeyPath}`);
    p.log.info(`${chalk.bold("Fingerprint:")} ${fingerprint}`);
  });

keysCommand
  .command("rotate")
  .description("Generate a new key pair and update all managed servers")
  .option("--json", "Output as JSON")
  .option("--yes", "Skip confirmations")
  .action(async (opts: { json?: boolean; yes?: boolean }) => {
    if (!hasSetup()) {
      outputError("Run 'hoist init' first.");
      process.exit(1);
    }

    const config = getConfig();
    const labels = Object.keys(config.providers);

    if (labels.length === 0) {
      outputError("No providers configured. Run 'hoist provider add' first.");
      process.exit(1);
    }

    const allServers: Array<ServerInfo & { provider: string }> = [];
    const spinner = p.spinner();

    if (!opts.json) spinner.start("Fetching servers from all providers...");

    for (const name of labels) {
      const providerConfig = config.providers[name];
      if (!providerConfig) continue;
      const provider = getProvider(providerConfig.type);
      try {
        const servers = await provider.listServers(providerConfig.apiKey);
        for (const server of servers) {
          allServers.push({ ...server, provider: name });
        }
      } catch (err) {
        if (!opts.json) {
          p.log.warning(
            `Failed to list servers from ${name}: ${err instanceof Error ? err.message : err}`
          );
        }
      }
    }

    if (!opts.json) spinner.stop(`Found ${allServers.length} server(s).`);

    const serversWithIp = allServers.filter((s) => s.ip);

    if (serversWithIp.length === 0) {
      outputError("No servers with IP addresses found.");
      process.exit(1);
    }

    if (!opts.yes && !opts.json) {
      const confirmed = await p.confirm({
        message: `Rotate SSH keys across ${serversWithIp.length} server(s)?`,
      });
      if (p.isCancel(confirmed) || !confirmed) return;
    }

    const oldPublicKey = readPublicKey();

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hoist-keys-"));
    const tmpPrivatePath = path.join(tmpDir, "hoist_ed25519");
    const tmpPublicPath = path.join(tmpDir, "hoist_ed25519.pub");

    if (!opts.json) spinner.start("Generating new key pair...");

    const newKeys = utils.generateKeyPairSync("ed25519", { comment: "hoist" });
    fs.writeFileSync(tmpPrivatePath, newKeys.private, { mode: 0o600 });
    fs.writeFileSync(tmpPublicPath, newKeys.public, { mode: 0o644 });

    const newPublicKey = newKeys.public.trim();

    if (!opts.json) spinner.stop("New key pair generated.");

    const results: Array<{
      server: string;
      ip: string;
      status: "ok" | "failed";
      error?: string;
    }> = [];

    for (const server of serversWithIp) {
      if (!opts.json)
        spinner.start(
          `Updating key on ${server.name} (${server.ip})...`
        );

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
        if (!opts.json)
          spinner.stop(
            `${chalk.green("Updated")} ${server.name} (${server.ip})`
          );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        results.push({
          server: server.name,
          ip: server.ip,
          status: "failed",
          error: message,
        });
        if (!opts.json)
          spinner.stop(
            `${chalk.red("Failed")} ${server.name}: ${message}`
          );
      } finally {
        closeConnection(sshOpts);
      }
    }

    const failed = results.filter((r) => r.status === "failed");

    if (failed.length > 0) {
      if (!opts.json) {
        p.log.warning(
          `${failed.length} server(s) failed. Old keys left in temp dir: ${tmpDir}`
        );
      }
      if (opts.json) {
        outputJson({
          status: "partial",
          message: `${failed.length} server(s) failed to update`,
          tmpDir,
          results,
        });
      }
      process.exit(1);
    }

    fs.copyFileSync(tmpPrivatePath, getPrivateKeyPath());
    fs.chmodSync(getPrivateKeyPath(), 0o600);
    fs.copyFileSync(tmpPublicPath, getPublicKeyPath());
    fs.chmodSync(getPublicKeyPath(), 0o644);

    fs.rmSync(tmpDir, { recursive: true, force: true });

    if (opts.json) {
      outputJson({
        status: "success",
        message: "Keys rotated successfully",
        serversUpdated: results.length,
        results,
      });
    } else {
      outputSuccess(
        `Keys rotated across ${results.length} server(s).`
      );
    }
  });
