import type {
  Provider,
  ProviderTestResult,
  ServerInfo,
  ServerTypeInfo,
  RegionInfo,
} from "./index.js";

const API_BASE = "https://developers.hostinger.com";

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
    throw new Error(`Hostinger API error ${res.status}: ${body}`);
  }
  return res.json() as Promise<T>;
}

interface HostingerVM {
  id: number;
  hostname: string;
  state: string;
  ipv4: Array<{ address: string }>;
  plan: string;
  datacenter: string;
  subscription_id: string;
}

interface HostingerDataCenter {
  id: number;
  name: string;
  location: string;
  city: string;
  continent: string;
}

interface HostingerCatalogItem {
  id: string;
  name: string;
  prices: Array<{
    id: string;
    amount: number;
    currency: string;
    period: number;
  }>;
}

async function ensureSSHKeyId(
  apiKey: string,
  publicKey: string
): Promise<number> {
  const keys = await apiJson<Array<{ id: number; key: string; name: string }>>(
    "/api/vps/v1/public-keys",
    apiKey
  );

  const existing = keys.find((k) => k.key.trim() === publicKey.trim());
  if (existing) return existing.id;

  const byName = keys.find((k) => k.name === "hoist");
  if (byName) {
    await api(`/api/vps/v1/public-keys/${byName.id}`, apiKey, { method: "DELETE" });
  }

  const created = await apiJson<{ id: number }>(
    "/api/vps/v1/public-keys",
    apiKey,
    {
      method: "POST",
      body: JSON.stringify({ name: "hoist", key: publicKey }),
    }
  );

  return created.id;
}

function formatVM(vm: HostingerVM): ServerInfo {
  return {
    id: String(vm.id),
    name: vm.hostname,
    status: vm.state,
    ip: vm.ipv4?.[0]?.address ?? "",
    type: vm.plan,
    region: vm.datacenter,
    monthlyCost: "",
  };
}

/** Hostinger VPS provider implementation. */
export const hostingerProvider: Provider = {
  async testConnection(apiKey: string): Promise<ProviderTestResult> {
    try {
      const dcs = await apiJson<HostingerDataCenter[]>(
        "/api/vps/v1/data-centers",
        apiKey
      );
      const count = dcs?.length ?? 0;
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
    const dcs = await apiJson<HostingerDataCenter[]>(
      "/api/vps/v1/data-centers",
      apiKey
    );
    return dcs.map((dc) => ({
      id: String(dc.id),
      name: dc.location,
      city: dc.city,
      country: dc.continent,
      available: true,
    }));
  },

  async listServerTypes(apiKey: string): Promise<ServerTypeInfo[]> {
    const catalog = await apiJson<HostingerCatalogItem[]>(
      "/api/billing/v1/catalog?category=vps",
      apiKey
    );
    return catalog.map((item) => {
      const monthly = item.prices.find((p) => p.period === 1);
      const cents = monthly ? monthly.amount : 0;
      const currency = monthly?.currency ?? "USD";
      return {
        id: monthly?.id ?? item.id,
        description: item.name,
        cpus: 0,
        memoryGb: 0,
        diskGb: 0,
        monthlyCostCents: cents,
        currency,
        monthlyCost: `${(cents / 100).toFixed(2)} ${currency}`,
      };
    });
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

    const templates = await apiJson<Array<{ id: number; name: string }>>(
      "/api/vps/v1/templates",
      apiKey
    );
    const ubuntu = templates.find((t) =>
      t.name.toLowerCase().includes("ubuntu") &&
      t.name.includes("24")
    ) ?? templates.find((t) =>
      t.name.toLowerCase().includes("ubuntu")
    );

    if (!ubuntu) {
      throw new Error("No Ubuntu template found on Hostinger");
    }

    const purchased = await apiJson<{ id: number }>(
      "/api/vps/v1/virtual-machines",
      apiKey,
      {
        method: "POST",
        body: JSON.stringify({
          item_id: opts.type,
          hostname: opts.name,
          data_center_id: Number(opts.region),
          template_id: ubuntu.id,
          public_key_ids: [sshKeyId],
        }),
      }
    );

    const start = Date.now();
    while (Date.now() - start < 180000) {
      const vm = await apiJson<HostingerVM>(
        `/api/vps/v1/virtual-machines/${purchased.id}`,
        apiKey
      );

      if (vm.state === "running" && vm.ipv4?.[0]?.address) {
        return formatVM(vm);
      }
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
    throw new Error("Server provisioning timed out after 3 minutes");
  },

  async listServers(apiKey: string): Promise<ServerInfo[]> {
    const vms = await apiJson<HostingerVM[]>(
      "/api/vps/v1/virtual-machines",
      apiKey
    );
    return vms.map(formatVM);
  },

  async getServer(apiKey: string, id: string): Promise<ServerInfo> {
    const vm = await apiJson<HostingerVM>(
      `/api/vps/v1/virtual-machines/${id}`,
      apiKey
    );
    return formatVM(vm);
  },

  async deleteServer(apiKey: string, id: string): Promise<void> {
    const vm = await apiJson<HostingerVM>(
      `/api/vps/v1/virtual-machines/${id}`,
      apiKey
    );
    await api(`/api/billing/v1/subscriptions/${vm.subscription_id}`, apiKey, {
      method: "DELETE",
    });
  },
};
