import fs from "node:fs";
import path from "node:path";
import ssh2 from "ssh2";
import { getKeysDir } from "./config.js";

const { utils } = ssh2;

const PRIVATE_KEY_NAME = "hoist_ed25519";
const PUBLIC_KEY_NAME = "hoist_ed25519.pub";

/** Returns the absolute path to the private key file. */
export function getPrivateKeyPath(): string {
  return path.join(getKeysDir(), PRIVATE_KEY_NAME);
}

/** Returns the absolute path to the public key file. */
export function getPublicKeyPath(): string {
  return path.join(getKeysDir(), PUBLIC_KEY_NAME);
}

/** Returns true if both SSH key files exist on disk. */
export function hasKeys(): boolean {
  return (
    fs.existsSync(getPrivateKeyPath()) && fs.existsSync(getPublicKeyPath())
  );
}

/** Generates an ed25519 key pair and writes them to the keys directory. */
export function generateKeys(): { privateKey: string; publicKey: string } {
  const keys = utils.generateKeyPairSync("ed25519", {
    comment: "hoist",
  });

  const keysDir = getKeysDir();
  fs.mkdirSync(keysDir, { recursive: true, mode: 0o700 });

  fs.writeFileSync(getPrivateKeyPath(), keys.private, { mode: 0o600 });
  fs.writeFileSync(getPublicKeyPath(), keys.public, { mode: 0o644 });

  return { privateKey: keys.private, publicKey: keys.public };
}

/** Reads and returns the public key contents. */
export function readPublicKey(): string {
  return fs.readFileSync(getPublicKeyPath(), "utf-8").trim();
}

/** Reads and returns the private key contents. */
export function readPrivateKey(): string {
  return fs.readFileSync(getPrivateKeyPath(), "utf-8");
}

/** Throws if the private key file is missing or has wrong permissions. */
export function validateKeyPermissions(): void {
  const privatePath = getPrivateKeyPath();
  if (!fs.existsSync(privatePath)) {
    throw new Error("SSH private key not found");
  }

  const stat = fs.statSync(privatePath);
  const mode = stat.mode & 0o777;
  if (mode !== 0o600) {
    throw new Error(
      `Key permissions are ${mode.toString(8)}, expected 600`
    );
  }
}
