import { execOrFail, type SSHConnectionOptions } from "./ssh.js";

const TRAEFIK_STATIC_CONFIG = `entryPoints:
  web:
    address: ":80"
    http:
      redirections:
        entryPoint:
          to: websecure
  websecure:
    address: ":443"
certificatesResolvers:
  letsencrypt:
    acme:
      storage: /etc/traefik/acme.json
      httpChallenge:
        entryPoint: web
providers:
  docker:
    endpoint: "unix:///var/run/docker.sock"
    exposedByDefault: false
    network: hoist
  file:
    directory: /etc/traefik/dynamic
    watch: true
`;

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
      "(systemctl reload ssh 2>/dev/null || systemctl reload sshd 2>/dev/null || true)",
    "Disabling SSH password auth"
  );

  await execStep(
    "docker network inspect hoist > /dev/null 2>&1 || docker network create hoist",
    "Creating Docker network"
  );

  await execStep(
    "mkdir -p /etc/traefik/dynamic && touch /etc/traefik/acme.json && chmod 600 /etc/traefik/acme.json",
    "Creating Traefik directories"
  );

  await execStep(
    `cat > /etc/traefik/traefik.yml << 'HOISTEOF'\n${TRAEFIK_STATIC_CONFIG}HOISTEOF`,
    "Writing Traefik static config"
  );

  await execStep(
    `docker inspect hoist-traefik > /dev/null 2>&1 || docker run -d \\
      --name hoist-traefik \\
      --network hoist \\
      --restart unless-stopped \\
      -p 80:80 \\
      -p 443:443 \\
      -v /etc/traefik:/etc/traefik \\
      -v /var/run/docker.sock:/var/run/docker.sock:ro \\
      traefik:v3`,
    "Starting Traefik reverse proxy"
  );

  await execStep("mkdir -p /var/log/hoist", "Creating audit log directory");

  await execStep(
    `echo '{"event":"server_setup","timestamp":"'$(date -u +%Y-%m-%dT%H:%M:%SZ)'"}' >> /var/log/hoist/audit.log`,
    "Logging setup event"
  );
}

/** Checks Docker, Traefik, and firewall status on the server. */
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
      "docker inspect hoist-traefik --format '{{.State.Status}}' 2>/dev/null | grep -q running"
    );
    details.push("Traefik: running");
  } catch {
    details.push("Traefik: not running");
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
