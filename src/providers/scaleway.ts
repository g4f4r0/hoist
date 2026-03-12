import type {
  Provider,
  ProviderTestResult,
  ServerInfo,
  ServerTypeInfo,
  RegionInfo,
} from "./index.js";

const API_BASE = "https://api.scaleway.com";
const DEFAULT_ZONE = "fr-par-1";

const ZONES: Array<{ id: string; name: string; city: string; country: string }> = [
  { id: "fr-par-1", name: "Paris 1", city: "Paris", country: "FR" },
  { id: "fr-par-2", name: "Paris 2", city: "Paris", country: "FR" },
  { id: "fr-par-3", name: "Paris 3", city: "Paris", country: "FR" },
  { id: "nl-ams-1", name: "Amsterdam 1", city: "Amsterdam", country: "NL" },
  { id: "nl-ams-2", name: "Amsterdam 2", city: "Amsterdam", country: "NL" },
  { id: "pl-waw-1", name: "Warsaw 1", city: "Warsaw", country: "PL" },
  { id: "pl-waw-2", name: "Warsaw 2", city: "Warsaw", country: "PL" },
];

async function api(
  path: string,
  apiKey: string,
  options?: RequestInit
): Promise<Response> {
  return fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "X-Auth-Token": apiKey,
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
    throw new Error(`Scaleway API error ${res.status}: ${body}`);
  }
  return res.json() as Promise<T>;
}

interface ScalewayServer {
  id: string;
  name: string;
  state: string;
  commercial_type: string;
  public_ip: { address: string } | null;
  public_ips: Array<{ address: string; family: string }>;
  tags: string[];
  location: { zone_id: string };
  volumes: Record<string, { id: string }>;
}

function formatServer(s: ScalewayServer): ServerInfo {
  const ip = s.public_ip?.address
    ?? s.public_ips?.find((p) => p.family === "inet")?.address
    ?? "";
  return {
    id: s.id,
    name: s.name,
    status: s.state,
    ip,
    type: s.commercial_type,
    region: s.location?.zone_id ?? "",
    monthlyCost: "",
  };
}

async function getProjectId(apiKey: string): Promise<string> {
  const data = await apiJson<{
    projects: Array<{ id: string }>;
    total_count: number;
  }>("/account/v3/projects", apiKey);
  if (!data.projects?.[0]) {
    throw new Error("No Scaleway project found");
  }
  return data.projects[0].id;
}

async function findUbuntuImage(apiKey: string, zone: string): Promise<string> {
  const data = await apiJson<{
    images: Array<{ id: string; name: string; arch: string }>;
  }>(`/instance/v1/zones/${zone}/images?name=Ubuntu&arch=x86_64&per_page=50`, apiKey);

  const image = data.images.find((i) =>
    i.name.includes("24.04") || i.name.includes("Noble")
  ) ?? data.images.find((i) =>
    i.name.includes("22.04") || i.name.includes("Jammy")
  );

  if (!image) {
    throw new Error("No Ubuntu image found on Scaleway");
  }
  return image.id;
}

async function ensureSSHKey(apiKey: string, publicKey: string, projectId: string): Promise<void> {
  const data = await apiJson<{
    ssh_keys: Array<{ public_key: string }>;
  }>("/account/v3/keys", apiKey);

  const exists = data.ssh_keys.some((k) => k.public_key.trim() === publicKey.trim());
  if (exists) return;

  await apiJson<unknown>("/account/v3/keys", apiKey, {
    method: "POST",
    body: JSON.stringify({
      name: "hoist",
      public_key: publicKey,
      project_id: projectId,
    }),
  });
}

/** Scaleway provider implementation. */
export const scalewayProvider: Provider = {
  async testConnection(apiKey: string): Promise<ProviderTestResult> {
    try {
      await apiJson<unknown>("/account/v3/projects", apiKey);
      return { ok: true, message: `${ZONES.length} zones available` };
    } catch (err) {
      return {
        ok: false,
        message: err instanceof Error ? err.message : "Unknown error",
      };
    }
  },

  async listRegions(apiKey: string): Promise<RegionInfo[]> {
    return ZONES.map((z) => ({
      id: z.id,
      name: z.name,
      city: z.city,
      country: z.country,
      available: true,
    }));
  },

  async listServerTypes(apiKey: string): Promise<ServerTypeInfo[]> {
    const data = await apiJson<{
      servers: Record<string, {
        ncpus: number;
        ram: number;
        monthly_price: number;
        baremetal: boolean;
      }>;
    }>(`/instance/v1/zones/${DEFAULT_ZONE}/products/servers`, apiKey);

    return Object.entries(data.servers)
      .filter(([, v]) => !v.baremetal)
      .map(([name, v]) => {
        const cents = Math.round(v.monthly_price * 100);
        return {
          id: name,
          description: `${name}: ${v.ncpus} vCPU, ${Math.round(v.ram / (1024 * 1024 * 1024))}GB RAM`,
          cpus: v.ncpus,
          memoryGb: v.ram / (1024 * 1024 * 1024),
          diskGb: 0,
          monthlyCostCents: cents,
          currency: "EUR",
          monthlyCost: `€${(cents / 100).toFixed(2)}`,
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
    const zone = opts.region || DEFAULT_ZONE;
    const projectId = await getProjectId(apiKey);
    await ensureSSHKey(apiKey, opts.sshKeyPublic, projectId);
    const imageId = await findUbuntuImage(apiKey, zone);

    const { server } = await apiJson<{ server: ScalewayServer }>(
      `/instance/v1/zones/${zone}/servers`,
      apiKey,
      {
        method: "POST",
        body: JSON.stringify({
          name: opts.name,
          commercial_type: opts.type,
          image: imageId,
          tags: ["managed-by=hoist"],
          dynamic_ip_required: true,
          project: projectId,
        }),
      }
    );

    await apiJson<unknown>(
      `/instance/v1/zones/${zone}/servers/${server.id}/action`,
      apiKey,
      {
        method: "POST",
        body: JSON.stringify({ action: "poweron" }),
      }
    );

    const start = Date.now();
    while (Date.now() - start < 120000) {
      const { server: current } = await apiJson<{ server: ScalewayServer }>(
        `/instance/v1/zones/${zone}/servers/${server.id}`,
        apiKey
      );
      if (current.state === "running" && current.public_ip?.address) {
        return formatServer(current);
      }
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
    throw new Error("Server provisioning timed out after 2 minutes");
  },

  async listServers(apiKey: string): Promise<ServerInfo[]> {
    const all: ServerInfo[] = [];
    for (const zone of ZONES) {
      const data = await apiJson<{
        servers: ScalewayServer[];
      }>(`/instance/v1/zones/${zone.id}/servers?tags=managed-by%3Dhoist&per_page=50`, apiKey);
      all.push(...data.servers.map(formatServer));
    }
    return all;
  },

  async getServer(apiKey: string, id: string): Promise<ServerInfo> {
    for (const zone of ZONES) {
      try {
        const { server } = await apiJson<{ server: ScalewayServer }>(
          `/instance/v1/zones/${zone.id}/servers/${id}`,
          apiKey
        );
        return formatServer(server);
      } catch {
        continue;
      }
    }
    throw new Error(`Server ${id} not found in any zone`);
  },

  async deleteServer(apiKey: string, id: string): Promise<void> {
    for (const zone of ZONES) {
      try {
        await apiJson<unknown>(
          `/instance/v1/zones/${zone.id}/servers/${id}/action`,
          apiKey,
          {
            method: "POST",
            body: JSON.stringify({ action: "terminate" }),
          }
        );
        return;
      } catch {
        continue;
      }
    }
    throw new Error(`Server ${id} not found in any zone`);
  },
};
