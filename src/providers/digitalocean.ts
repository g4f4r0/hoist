import type {
  Provider,
  ProviderTestResult,
  ServerInfo,
  ServerTypeInfo,
  RegionInfo,
} from "./index.js";

const API_BASE = "https://api.digitalocean.com/v2";

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
    throw new Error(`DigitalOcean API error ${res.status}: ${body}`);
  }
  return res.json() as Promise<T>;
}

export const digitaloceanProvider: Provider = {
  async testConnection(apiKey: string): Promise<ProviderTestResult> {
    try {
      const data = await apiJson<{
        regions: Array<{ slug: string; available: boolean }>;
      }>("/regions", apiKey);
      const count = data.regions?.filter((region) => region.available).length ?? 0;
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
    const data = await apiJson<{
      regions: Array<{
        slug: string;
        name: string;
        available: boolean;
      }>;
    }>("/regions", apiKey);
    return data.regions
      .filter((region) => region.available)
      .map((region) => ({
        id: region.slug,
        name: region.name,
        city: region.name,
        country: "",
      }));
  },

  async listServerTypes(apiKey: string): Promise<ServerTypeInfo[]> {
    const data = await apiJson<{
      sizes: Array<{
        slug: string;
        vcpus: number;
        memory: number;
        disk: number;
        price_monthly: number;
        available: boolean;
        description: string;
      }>;
    }>("/sizes", apiKey);
    return data.sizes
      .filter((size) => size.available && size.slug.startsWith("s-"))
      .map((size) => ({
        id: size.slug,
        description:
          size.description ||
          `${size.vcpus} vCPU, ${size.memory / 1024}GB RAM, ${size.disk}GB disk`,
        cpus: size.vcpus,
        memoryGb: size.memory / 1024,
        diskGb: size.disk,
        monthlyCost: `$${size.price_monthly}`,
      }));
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
    const { ssh_keys } = await apiJson<{
      ssh_keys: Array<{ id: number; public_key: string }>;
    }>("/account/keys", apiKey);

    let sshKeyId = ssh_keys.find(
      (k) => k.public_key.trim() === opts.sshKeyPublic.trim()
    )?.id;

    if (!sshKeyId) {
      const { ssh_key } = await apiJson<{ ssh_key: { id: number } }>(
        "/account/keys",
        apiKey,
        {
          method: "POST",
          body: JSON.stringify({
            name: "hoist",
            public_key: opts.sshKeyPublic,
          }),
        }
      );
      sshKeyId = ssh_key.id;
    }

    const { droplet } = await apiJson<{
      droplet: { id: number };
    }>("/droplets", apiKey, {
      method: "POST",
      body: JSON.stringify({
        name: opts.name,
        size: opts.type,
        region: opts.region,
        image: "ubuntu-24-04-x64",
        ssh_keys: [sshKeyId],
        tags: ["hoist"],
      }),
    });

    const start = Date.now();
    while (Date.now() - start < 120000) {
      const { droplet: d } = await apiJson<{
        droplet: {
          id: number;
          name: string;
          status: string;
          size_slug: string;
          region: { slug: string };
          networks: {
            v4: Array<{ ip_address: string; type: string }>;
          };
        };
      }>(`/droplets/${droplet.id}`, apiKey);

      const publicIp = d.networks.v4.find(
        (n) => n.type === "public"
      )?.ip_address;

      if (d.status === "active" && publicIp) {
        return {
          id: String(d.id),
          name: d.name,
          status: d.status,
          ip: publicIp,
          type: d.size_slug,
          region: d.region.slug,
          monthlyCost: "",
        };
      }
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
    throw new Error("Server provisioning timed out after 2 minutes");
  },

  async listServers(apiKey: string): Promise<ServerInfo[]> {
    const data = await apiJson<{
      droplets: Array<{
        id: number;
        name: string;
        status: string;
        size_slug: string;
        region: { slug: string };
        networks: {
          v4: Array<{ ip_address: string; type: string }>;
        };
      }>;
    }>("/droplets?tag_name=hoist", apiKey);
    return data.droplets.map((d) => ({
      id: String(d.id),
      name: d.name,
      status: d.status,
      ip: d.networks.v4.find((n) => n.type === "public")?.ip_address ?? "",
      type: d.size_slug,
      region: d.region.slug,
      monthlyCost: "",
    }));
  },

  async getServer(apiKey: string, id: string): Promise<ServerInfo> {
    const { droplet } = await apiJson<{
      droplet: {
        id: number;
        name: string;
        status: string;
        size_slug: string;
        region: { slug: string };
        networks: {
          v4: Array<{ ip_address: string; type: string }>;
        };
      };
    }>(`/droplets/${id}`, apiKey);
    return {
      id: String(droplet.id),
      name: droplet.name,
      status: droplet.status,
      ip: droplet.networks.v4.find((n) => n.type === "public")?.ip_address ?? "",
      type: droplet.size_slug,
      region: droplet.region.slug,
      monthlyCost: "",
    };
  },

  async removeServer(apiKey: string, id: string): Promise<void> {
    await api(`/droplets/${id}`, apiKey, { method: "DELETE" });
  },
};
