import { execOrFail, type SSHConnectionOptions } from "./ssh.js";

/** Runs the idempotent setup script on a fresh server after provisioning. */
export async function setupServer(
  ssh: SSHConnectionOptions,
  onLog?: (msg: string) => void
): Promise<void> {
  const execStep = async (cmd: string, label: string) => {
    onLog?.(`  ${label}...`);
    await execOrFail(ssh, cmd);
  };

  await execStep(
    "cloud-init status --wait 2>/dev/null || true",
    "Waiting for cloud-init"
  );

  await execStep(
    "which docker > /dev/null 2>&1 || (curl -fsSL https://get.docker.com | sh)",
    "Installing Docker"
  );

  await execStep("systemctl enable docker && systemctl start docker", "Starting Docker");

  await execStep(
    "which ufw > /dev/null 2>&1 || apt-get install -y ufw > /dev/null 2>&1",
    "Installing UFW"
  );
  await execStep(
    "ufw default deny incoming && ufw default allow outgoing && ufw allow 22/tcp && ufw allow 80/tcp && ufw allow 443/tcp && echo 'y' | ufw enable",
    "Configuring firewall (22, 80, 443)"
  );

  await execStep(
    "sed -i 's/#\\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config && " +
      "sed -i 's/#\\?ChallengeResponseAuthentication.*/ChallengeResponseAuthentication no/' /etc/ssh/sshd_config && " +
      "systemctl reload sshd",
    "Disabling SSH password auth"
  );

  await execStep(
    "docker network inspect hoist > /dev/null 2>&1 || docker network create hoist",
    "Creating Docker network"
  );

  await execStep(
    `docker inspect hoist-caddy > /dev/null 2>&1 || docker run -d \\
      --name hoist-caddy \\
      --network hoist \\
      --restart unless-stopped \\
      -p 80:80 \\
      -p 443:443 \\
      -v hoist-caddy-data:/data \\
      -v hoist-caddy-config:/config \\
      caddy:2-alpine`,
    "Starting Caddy reverse proxy"
  );

  await execStep("mkdir -p /var/log/hoist", "Creating audit log directory");

  await execStep(
    `echo '{"event":"server_setup","timestamp":"'$(date -u +%Y-%m-%dT%H:%M:%SZ)'"}' >> /var/log/hoist/audit.log`,
    "Logging setup event"
  );
}

/** Checks Docker, Caddy, and firewall status on the server. */
export async function checkHealth(
  ssh: SSHConnectionOptions
): Promise<{ healthy: boolean; details: string[] }> {
  const details: string[] = [];
  let healthy = true;

  try {
    await execOrFail(ssh, "docker info > /dev/null 2>&1");
    details.push("Docker: running");
  } catch {
    details.push("Docker: not running");
    healthy = false;
  }

  try {
    await execOrFail(
      ssh,
      "docker inspect hoist-caddy --format '{{.State.Status}}' 2>/dev/null | grep -q running"
    );
    details.push("Caddy: running");
  } catch {
    details.push("Caddy: not running");
    healthy = false;
  }

  try {
    const { stdout } = await execOrFail(ssh, "ufw status | head -1");
    details.push(`Firewall: ${stdout.trim()}`);
  } catch {
    details.push("Firewall: unknown");
  }

  return { healthy, details };
}
