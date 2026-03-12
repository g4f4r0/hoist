import { exec, execOrFail, type SSHConnectionOptions } from "./ssh.js";

export interface RouteInfo {
  appName: string;
  domain: string;
  upstream: string;
}

/** Returns true if the domain is an auto-generated sslip.io domain. */
export function isAutoDomain(domain: string): boolean {
  return domain.endsWith(".sslip.io");
}

/** Returns the canonical and alternate www/non-www pair for a domain. */
export function parseWwwPair(domain: string): { canonical: string; alternate: string } {
  if (domain.startsWith("www.")) {
    return { canonical: domain, alternate: domain.slice(4) };
  }
  return { canonical: domain, alternate: `www.${domain}` };
}

function escapeForRegex(domain: string): string {
  return domain.replace(/\./g, "\\.");
}

function buildSimpleRouteYaml(appName: string, domain: string, upstream: string): string {
  return `http:
  routers:
    ${appName}:
      rule: "Host(\`${domain}\`)"
      entryPoints: [websecure]
      tls:
        certResolver: letsencrypt
      service: ${appName}
  services:
    ${appName}:
      loadBalancer:
        servers:
          - url: "http://${upstream}"
`;
}

function buildWwwRouteYaml(appName: string, domain: string, upstream: string): string {
  const { canonical, alternate } = parseWwwPair(domain);
  const escapedAlternate = escapeForRegex(alternate);

  return `http:
  routers:
    ${appName}:
      rule: "Host(\`${canonical}\`)"
      entryPoints: [websecure]
      tls:
        certResolver: letsencrypt
      service: ${appName}
    ${appName}-www-redirect:
      rule: "Host(\`${alternate}\`)"
      entryPoints: [websecure]
      tls:
        certResolver: letsencrypt
      middlewares: [${appName}-redirect]
      service: ${appName}
  middlewares:
    ${appName}-redirect:
      redirectRegex:
        regex: "^https://${escapedAlternate}/(.*)"
        replacement: "https://${canonical}/\${1}"
        permanent: true
  services:
    ${appName}:
      loadBalancer:
        servers:
          - url: "http://${upstream}"
`;
}

function buildRouteYaml(appName: string, domain: string, upstream: string): string {
  if (isAutoDomain(domain)) {
    return buildSimpleRouteYaml(appName, domain, upstream);
  }
  return buildWwwRouteYaml(appName, domain, upstream);
}

/** Generates a sslip.io domain from app name and server IP. */
export function generateAutoDomain(appName: string, ip: string): string {
  return `${appName}.${ip.replace(/\./g, "-")}.sslip.io`;
}

/** Adds a route by writing a dynamic config YAML file. */
export async function addRoute(
  ssh: SSHConnectionOptions,
  appName: string,
  domain: string,
  upstream: string
): Promise<void> {
  const yaml = buildRouteYaml(appName, domain, upstream);
  await execOrFail(
    ssh,
    `cat > /etc/traefik/dynamic/${appName}.yml << 'HOISTEOF'\n${yaml}HOISTEOF`
  );
}

/** Deletes a route by removing its YAML file. */
export async function deleteRoute(
  ssh: SSHConnectionOptions,
  appName: string
): Promise<void> {
  await execOrFail(ssh, `rm -f /etc/traefik/dynamic/${appName}.yml`);
}

/** Lists routes by reading dynamic config files. */
export async function listRoutes(
  ssh: SSHConnectionOptions
): Promise<RouteInfo[]> {
  const ls = await exec(ssh, "ls /etc/traefik/dynamic/*.yml 2>/dev/null");
  if (ls.code !== 0 || !ls.stdout.trim()) return [];

  const files = ls.stdout.trim().split("\n");
  const routes: RouteInfo[] = [];

  for (const file of files) {
    const appName = file.replace(/^.*\//, "").replace(/\.yml$/, "");
    const { stdout } = await execOrFail(ssh, `cat ${file}`);

    const domainMatch = stdout.match(/Host\(`([^`]+)`\)/);
    const upstreamMatch = stdout.match(/url:\s*"http:\/\/([^"]+)"/);

    if (domainMatch && upstreamMatch) {
      routes.push({
        appName,
        domain: domainMatch[1],
        upstream: upstreamMatch[1],
      });
    }
  }

  return routes;
}

/** Updates the upstream for a route or creates one with an auto-domain if none exists. */
export async function updateRouteUpstream(
  ssh: SSHConnectionOptions,
  appName: string,
  newUpstream: string
): Promise<void> {
  const file = `/etc/traefik/dynamic/${appName}.yml`;
  const result = await exec(ssh, `cat ${file} 2>/dev/null`);

  if (result.code !== 0 || !result.stdout.trim()) {
    const domain = generateAutoDomain(appName, ssh.host);
    await addRoute(ssh, appName, domain, newUpstream);
    return;
  }

  const domainMatch = result.stdout.match(/Host\(`([^`]+)`\)/);
  if (!domainMatch) {
    const domain = generateAutoDomain(appName, ssh.host);
    await addRoute(ssh, appName, domain, newUpstream);
    return;
  }

  const domain = domainMatch[1];
  await addRoute(ssh, appName, domain, newUpstream);
}

/** Reads cert info from acme.json. */
export async function listCerts(
  ssh: SSHConnectionOptions
): Promise<Array<{ domain: string; expiry: string }>> {
  const result = await exec(ssh, "cat /etc/traefik/acme.json 2>/dev/null");
  if (result.code !== 0 || !result.stdout.trim()) return [];

  try {
    const acme = JSON.parse(result.stdout) as Record<string, {
      Certificates?: Array<{
        domain: { main: string };
        certificate: string;
      }>;
    }>;

    const certs: Array<{ domain: string; expiry: string }> = [];
    for (const resolver of Object.values(acme)) {
      for (const cert of resolver.Certificates ?? []) {
        certs.push({
          domain: cert.domain.main,
          expiry: "unknown",
        });
      }
    }
    return certs;
  } catch {
    return [];
  }
}
