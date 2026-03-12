import { execSync } from "node:child_process";

import { getConnection, type SSHConnectionOptions } from "./ssh.js";

const DEFAULT_EXCLUDES = ["node_modules", ".git", "dist"];

/** Uploads a local directory to a remote server by streaming tar over SSH. */
export async function uploadDirectory(
  ssh: SSHConnectionOptions,
  localDir: string,
  remoteDir: string,
  exclude?: string[]
): Promise<void> {
  const excludes = [...DEFAULT_EXCLUDES, ...(exclude ?? [])];
  const excludeArgs = excludes.map((e) => `--exclude ${e}`).join(" ");

  const tarBuffer = execSync(`tar czf - -C ${localDir} ${excludeArgs} .`, {
    maxBuffer: 500 * 1024 * 1024,
  });

  const conn = await getConnection(ssh);

  await new Promise<void>((resolve, reject) => {
    conn.exec(
      `mkdir -p ${remoteDir} && tar xzf - -C ${remoteDir}`,
      (err, stream) => {
        if (err) {
          reject(new Error(`Failed to start remote tar: ${err.message}`));
          return;
        }

        let stderr = "";

        stream.on("exit", (code: number) => {
          if (code !== 0) {
            reject(new Error(`Remote tar failed (exit ${code}): ${stderr}`));
            return;
          }
          resolve();
        });

        stream.stderr.on("data", (data: Buffer) => {
          stderr += data.toString();
        });

        stream.end(tarBuffer);
      }
    );
  });
}
