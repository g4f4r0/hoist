import crypto from "node:crypto";

import type {
  Provider,
  ProviderTestResult,
  ServerInfo,
  ServerTypeInfo,
  RegionInfo,
} from "./index.js";

const API_BASE = "https://api.linode.com/v4";

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
    throw new Error(`Linode API error ${res.status}: ${body}`);
  }
  return res.json() as Promise<T>;
}

interface LinodeInstance {
  id: number;
  label: string;
  status: string;
  type: string;
  region: string;
  ipv4: string[];
  tags: string[];
}

interface LinodePaginated<T> {
  data: T[];
  page: number;
  pages: number;
  results: number;
}

function formatInstance(inst: LinodeInstance): ServerInfo {
  return {
    id: String(inst.id),
    name: inst.label,
    status: inst.status,
    ip: inst.ipv4?.[0] ?? "",
    type: inst.type,
    region: inst.region,
    monthlyCost: "",
  };
}

/** Linode provider implementation. */
export const linodeProvider: Provider = {
  async testConnection(apiKey: string): Promise<ProviderTestResult> {
    try {
      const data = await apiJson<LinodePaginated<{ id: string; status: string }>>(
        "/regions",
        apiKey
      );
      const count = data.data?.filter((r) => r.status === "ok").length ?? 0;
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
    const data = await apiJson<LinodePaginated<{
      id: string;
      label: string;
      country: string;
      status: string;
    }>>("/regions", apiKey);
    return data.data
      .filter((r) => r.status === "ok")
      .map((r) => ({
        id: r.id,
        name: r.label,
        city: r.label,
        country: r.country,
        available: true,
      }));
  },

  async listServerTypes(apiKey: string): Promise<ServerTypeInfo[]> {
    const data = await apiJson<LinodePaginated<{
      id: string;
      label: string;
      class: string;
      vcpus: number;
      memory: number;
      disk: number;
      price: { monthly: number };
    }>>("/linode/types", apiKey);
    return data.data
      .filter((t) => ["nanode", "standard", "dedicated"].includes(t.class))
      .map((t) => ({
        id: t.id,
        description: t.label,
        cpus: t.vcpus,
        memoryGb: t.memory / 1024,
        diskGb: t.disk / 1024,
        monthlyCostCents: Math.round(t.price.monthly * 100),
        currency: "USD",
        monthlyCost: `$${t.price.monthly}`,
      }))
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
    const rootPass = crypto.randomBytes(24).toString("base64url") + "!A1";

    const inst = await apiJson<LinodeInstance>(
      "/linode/instances",
      apiKey,
      {
        method: "POST",
        body: JSON.stringify({
          label: opts.name,
          type: opts.type,
          region: opts.region,
          image: "linode/ubuntu24.04",
          root_pass: rootPass,
          authorized_keys: [opts.sshKeyPublic],
          tags: ["managed-by:hoist"],
          booted: true,
        }),
      }
    );

    const start = Date.now();
    while (Date.now() - start < 120000) {
      const current = await apiJson<LinodeInstance>(
        `/linode/instances/${inst.id}`,
        apiKey
      );
      if (current.status === "running" && current.ipv4?.[0]) {
        return formatInstance(current);
      }
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
    throw new Error("Server provisioning timed out after 2 minutes");
  },

  async listServers(apiKey: string): Promise<ServerInfo[]> {
    const data = await apiJson<LinodePaginated<LinodeInstance>>(
      "/linode/instances",
      apiKey,
      {
        headers: {
          "X-Filter": JSON.stringify({ tags: "managed-by:hoist" }),
        },
      }
    );
    return data.data.map(formatInstance);
  },

  async getServer(apiKey: string, id: string): Promise<ServerInfo> {
    const inst = await apiJson<LinodeInstance>(
      `/linode/instances/${id}`,
      apiKey
    );
    return formatInstance(inst);
  },

  async deleteServer(apiKey: string, id: string): Promise<void> {
    await api(`/linode/instances/${id}`, apiKey, { method: "DELETE" });
  },
};
