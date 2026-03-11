import type {
  Provider,
  ProviderTestResult,
  ServerInfo,
  ServerTypeInfo,
  RegionInfo,
} from "./index.js";

const API_BASE = "https://api.vultr.com/v2";

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
    throw new Error(`Vultr API error ${res.status}: ${body}`);
  }
  return res.json() as Promise<T>;
}

export const vultrProvider: Provider = {
  async testConnection(apiKey: string): Promise<ProviderTestResult> {
    try {
      const data = await apiJson<{ regions: Array<{ id: string }> }>(
        "/regions",
        apiKey
      );
      const count = data.regions?.length ?? 0;
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
        id: string;
        city: string;
        country: string;
      }>;
    }>("/regions", apiKey);
    return data.regions.map((region) => ({
      id: region.id,
      name: `${region.city}, ${region.country}`,
      city: region.city,
      country: region.country,
    }));
  },

  async listServerTypes(apiKey: string): Promise<ServerTypeInfo[]> {
    const data = await apiJson<{
      plans: Array<{
        id: string;
        vcpu_count: number;
        ram: number;
        disk: number;
        monthly_cost: number;
      }>;
    }>("/plans?type=vc2", apiKey);
    return data.plans.map((plan) => ({
      id: plan.id,
      description: `${plan.vcpu_count} vCPU, ${plan.ram / 1024}GB RAM, ${plan.disk}GB disk`,
      cpus: plan.vcpu_count,
      memoryGb: plan.ram / 1024,
      diskGb: plan.disk,
      monthlyCost: `$${plan.monthly_cost}`,
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
      ssh_keys: Array<{ id: string; ssh_key: string }>;
    }>("/ssh-keys", apiKey);

    let sshKeyId = ssh_keys.find(
      (k) => k.ssh_key.trim() === opts.sshKeyPublic.trim()
    )?.id;

    if (!sshKeyId) {
      const { ssh_key } = await apiJson<{ ssh_key: { id: string } }>(
        "/ssh-keys",
        apiKey,
        {
          method: "POST",
          body: JSON.stringify({
            name: "hoist",
            ssh_key: opts.sshKeyPublic,
          }),
        }
      );
      sshKeyId = ssh_key.id;
    }

    const { instance } = await apiJson<{
      instance: { id: string; main_ip: string; status: string };
    }>("/instances", apiKey, {
      method: "POST",
      body: JSON.stringify({
        label: opts.name,
        plan: opts.type,
        region: opts.region,
        os_id: 2284, // Ubuntu 24.04
        sshkey_id: [sshKeyId],
        tags: ["hoist"],
      }),
    });

    const start = Date.now();
    while (Date.now() - start < 120000) {
      const { instance: inst } = await apiJson<{
        instance: {
          id: string;
          label: string;
          main_ip: string;
          status: string;
          plan: string;
          region: string;
        };
      }>(`/instances/${instance.id}`, apiKey);

      if (inst.status === "active" && inst.main_ip !== "0.0.0.0") {
        return {
          id: inst.id,
          name: inst.label,
          status: inst.status,
          ip: inst.main_ip,
          type: inst.plan,
          region: inst.region,
          monthlyCost: "",
        };
      }
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
    throw new Error("Server provisioning timed out after 2 minutes");
  },

  async listServers(apiKey: string): Promise<ServerInfo[]> {
    const data = await apiJson<{
      instances: Array<{
        id: string;
        label: string;
        main_ip: string;
        status: string;
        plan: string;
        region: string;
        tags: string[];
      }>;
    }>("/instances?tag=hoist", apiKey);
    return data.instances.map((inst) => ({
      id: inst.id,
      name: inst.label,
      status: inst.status,
      ip: inst.main_ip,
      type: inst.plan,
      region: inst.region,
      monthlyCost: "",
    }));
  },

  async getServer(apiKey: string, id: string): Promise<ServerInfo> {
    const { instance } = await apiJson<{
      instance: {
        id: string;
        label: string;
        main_ip: string;
        status: string;
        plan: string;
        region: string;
      };
    }>(`/instances/${id}`, apiKey);
    return {
      id: instance.id,
      name: instance.label,
      status: instance.status,
      ip: instance.main_ip,
      type: instance.plan,
      region: instance.region,
      monthlyCost: "",
    };
  },

  async deleteServer(apiKey: string, id: string): Promise<void> {
    await api(`/instances/${id}`, apiKey, { method: "DELETE" });
  },
};
