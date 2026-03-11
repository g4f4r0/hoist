import { getConfig, type ProviderConfig } from "./config.js";
import { getProvider, type Provider } from "../providers/index.js";

/** Resolves a provider by label or falls back to the configured default. */
export function getConfiguredProvider(providerLabel?: string): {
  label: string;
  providerConfig: ProviderConfig;
  provider: Provider;
} {
  const config = getConfig();
  const label = providerLabel ?? config.defaults.provider;
  if (!label) {
    throw new Error("No provider specified and no default set.");
  }
  const providerConfig = config.providers[label];
  if (!providerConfig) {
    throw new Error(`Provider "${label}" not found in config.`);
  }
  return { label, providerConfig, provider: getProvider(providerConfig.type) };
}

/** Looks up a server by name via the provider API or imported servers config. */
export async function resolveServer(
  serverName: string,
  serverConfig: { provider: string }
): Promise<{ ip: string; id: string; provider: string }> {
  if (serverConfig.provider === "imported") {
    const config = getConfig();
    const imported = config.importedServers?.[serverName];
    if (imported) {
      return { ip: imported.ip, id: serverName, provider: "imported" };
    }
    throw new Error(`Imported server "${serverName}" not found in config.`);
  }

  const { providerConfig, provider } = getConfiguredProvider(
    serverConfig.provider
  );
  const servers = await provider.listServers(providerConfig.apiKey);
  const match = servers.find((s) => s.name === serverName);
  if (!match) {
    throw new Error(
      `Server "${serverName}" not found on provider "${serverConfig.provider}".`
    );
  }
  return { ip: match.ip, id: match.id, provider: serverConfig.provider };
}

/** Resolves all servers, deduplicating API calls for servers sharing a provider. */
export async function resolveServers(
  servers: Record<string, { provider: string }>
): Promise<Record<string, { ip: string; id: string; provider: string }>> {
  const byProvider = new Map<string, string[]>();
  for (const [name, config] of Object.entries(servers)) {
    const existing = byProvider.get(config.provider) ?? [];
    existing.push(name);
    byProvider.set(config.provider, existing);
  }

  const result: Record<string, { ip: string; id: string; provider: string }> =
    {};

  const tasks = [...byProvider.entries()].map(
    async ([providerLabel, names]) => {
      if (providerLabel === "imported") {
        const config = getConfig();
        for (const name of names) {
          const imported = config.importedServers?.[name];
          if (!imported) {
            throw new Error(`Imported server "${name}" not found in config.`);
          }
          result[name] = { ip: imported.ip, id: name, provider: "imported" };
        }
        return;
      }

      const { providerConfig, provider } =
        getConfiguredProvider(providerLabel);
      const serverList = await provider.listServers(providerConfig.apiKey);

      for (const name of names) {
        const match = serverList.find((s) => s.name === name);
        if (!match) {
          throw new Error(
            `Server "${name}" not found on provider "${providerLabel}".`
          );
        }
        result[name] = { ip: match.ip, id: match.id, provider: providerLabel };
      }
    }
  );

  await Promise.all(tasks);
  return result;
}
