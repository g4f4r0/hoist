import type {
  Provider,
  ProviderTestResult,
  ServerInfo,
  ServerTypeInfo,
  RegionInfo,
} from "./index.js";

const API_BASE = "https://api.hetzner.cloud/v1";

async function api(
  path: string,
  apiKey: string,
  options?: RequestInit
): Promise<Response> {
  return fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });
}

async function apiJson<T>(
  path: string,
  apiKey: string,
  options?: RequestInit
): Promise<T> {
  const res = await api(path, apiKey, options);
  if (res.status === 401 || res.status === 403) {
    throw new Error("Invalid API key");
  }
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Hetzner API error ${res.status}: ${body}`);
  }
  return res.json() as Promise<T>;
}

async function ensureSSHKeyId(
  apiKey: string,
  publicKey: string
): Promise<number> {
  const { ssh_keys: sshKeys } = await apiJson<{
    ssh_keys: Array<{ id: number; name: string; public_key: string }>;
  }>("/ssh_keys", apiKey);

  const byContent = sshKeys.find(
    (k) => k.public_key.trim() === publicKey.trim()
  );
  if (byContent) return byContent.id;

  const byName = sshKeys.find((k) => k.name === "hoist");
  if (byName) {
    await api(`/ssh_keys/${byName.id}`, apiKey, { method: "DELETE" });
  }

  const { ssh_key: created } = await apiJson<{
    ssh_key: { id: number };
  }>("/ssh_keys", apiKey, {
    method: "POST",
    body: JSON.stringify({
      name: "hoist",
      public_key: publicKey,
    }),
  });

  return created.id;
}

async function waitForServer(
  apiKey: string,
  serverId: number,
  timeoutMs = 120000
): Promise<ServerInfo> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const { server } = await apiJson<{ server: HetznerServer }>(
      `/servers/${serverId}`,
      apiKey
    );

    if (
      server.status === "running" &&
      server.public_net?.ipv4?.ip
    ) {
      return formatServer(server);
    }

    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  throw new Error("Server provisioning timed out after 2 minutes");
}

interface HetznerServer {
  id: number;
  name: string;
  status: string;
  public_net: {
    ipv4: { ip: string } | null;
  };
  server_type: { name: string; description: string };
  datacenter: { name: string; location: { name: string } };
  labels: Record<string, string>;
}

function formatServer(s: HetznerServer): ServerInfo {
  return {
    id: String(s.id),
    name: s.name,
    status: s.status,
    ip: s.public_net?.ipv4?.ip ?? "",
    type: s.server_type.name,
    region: s.datacenter.location.name,
    monthlyCost: "",
  };
}

interface HetznerServerType {
  id: number;
  name: string;
  description: string;
  cores: number;
  memory: number;
  disk: number;
  deprecated: boolean;
  deprecation: { announced: string } | null;
  prices: Array<{
    location: string;
    price_monthly: { gross: string };
  }>;
}

interface HetznerLocation {
  id: number;
  name: string;
  description: string;
  city: string;
  country: string;
}

/** Hetzner Cloud provider implementation. */
export const hetznerProvider: Provider = {
  async testConnection(apiKey: string): Promise<ProviderTestResult> {
    try {
      const data = await apiJson<{ locations: HetznerLocation[] }>(
        "/locations",
        apiKey
      );
      const count = data.locations?.length ?? 0;
      return {
        ok: true,
        message: `${count} region${count !== 1 ? "s" : ""} available`,
      };
    } catch (err) {
      return {
        ok: false,
        message: err instanceof Error ? err.message : "Unknown error",
      };
    }
  },

  async listRegions(apiKey: string): Promise<RegionInfo[]> {
    const data = await apiJson<{ locations: HetznerLocation[] }>(
      "/locations",
      apiKey
    );
    return data.locations.map((loc) => ({
      id: loc.name,
      name: loc.description,
      city: loc.city,
      country: loc.country,
      available: true,
    }));
  },

  async listServerTypes(apiKey: string): Promise<ServerTypeInfo[]> {
    const data = await apiJson<{ server_types: HetznerServerType[] }>(
      "/server_types",
      apiKey
    );
    return data.server_types
      .filter((t) => !t.deprecated && !t.deprecation)
      .filter((t) => t.name.startsWith("cx") || t.name.startsWith("cax") || t.name.startsWith("cpx"))
      .map((t) => {
        const grossStr = t.prices[0]?.price_monthly?.gross;
        const cents = grossStr ? Math.round(parseFloat(grossStr) * 100) : 0;
        return {
          id: t.name,
          description: t.description,
          cpus: t.cores,
          memoryGb: t.memory,
          diskGb: t.disk,
          monthlyCostCents: cents,
          currency: "EUR",
          monthlyCost: grossStr
            ? `€${parseFloat(grossStr).toFixed(2)}`
            : "N/A",
        };
      })
      .sort((a, b) => a.monthlyCostCents - b.monthlyCostCents);
  },

  async createServer(
    apiKey: string,
    opts: {
      name: string;
      type: string;
      region: string;
      sshKeyPublic: string;
    }
  ): Promise<ServerInfo> {
    const sshKeyId = await ensureSSHKeyId(apiKey, opts.sshKeyPublic);

    const { server } = await apiJson<{ server: HetznerServer }>(
      "/servers",
      apiKey,
      {
        method: "POST",
        body: JSON.stringify({
          name: opts.name,
          server_type: opts.type,
          location: opts.region,
          image: "ubuntu-24.04",
          ssh_keys: [sshKeyId],
          labels: { "managed-by": "hoist" },
        }),
      }
    );

    return waitForServer(apiKey, server.id);
  },

  async listServers(apiKey: string): Promise<ServerInfo[]> {
    const data = await apiJson<{ servers: HetznerServer[] }>(
      "/servers?label_selector=managed-by%3Dhoist",
      apiKey
    );
    return data.servers.map(formatServer);
  },

  async getServer(apiKey: string, id: string): Promise<ServerInfo> {
    const data = await apiJson<{ server: HetznerServer }>(
      `/servers/${id}`,
      apiKey
    );
    return formatServer(data.server);
  },

  async deleteServer(apiKey: string, id: string): Promise<void> {
    await apiJson<unknown>(`/servers/${id}`, apiKey, { method: "DELETE" });
  },
};
