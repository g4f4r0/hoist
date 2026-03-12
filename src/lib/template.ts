import crypto from "node:crypto";

export interface Template {
  name: string;
  description: string;
  image: string;
  defaultVersion: string;
  port: number;
  volumes: Record<string, string>;
  env: Record<string, string>;
  command?: string;
  connectionString?: string;
  healthCheck?: string;
}

export interface ResolvedTemplate {
  image: string;
  containerName: string;
  env: Record<string, string>;
  volumes: Record<string, string>;
  port: number;
  command: string;
  connectionString: string;
  healthCheck: string;
  labels: Record<string, string>;
}

/** Generate a URL-safe alphanumeric password. */
export function generatePassword(length = 32): string {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = crypto.randomBytes(length);
  let result = "";
  for (let i = 0; i < length; i++) {
    result += chars[bytes[i] % chars.length];
  }
  return result;
}

/** Resolve a template into a fully expanded container configuration. */
export function resolveTemplate(
  template: Template,
  serviceName: string,
  version?: string,
): ResolvedTemplate {
  const containerName = serviceName;
  const resolvedVersion = version ?? template.defaultVersion;

  const resolveFirstPass = (value: string): string => {
    return value
      .replace(/\{\{generate:password\}\}/g, () => generatePassword())
      .replace(/\{\{generate:username\}\}/g, "hoist")
      .replace(/\{\{version\}\}/g, resolvedVersion);
  };

  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(template.env)) {
    env[key] = resolveFirstPass(value);
  }

  const image = resolveFirstPass(template.image);
  const command = template.command ? resolveFirstPass(template.command) : "";

  const resolveSecondPass = (value: string): string => {
    return value
      .replace(/\{\{env:(\w+)\}\}/g, (_, key: string) => env[key] ?? "")
      .replace(/\{\{container\}\}/g, containerName)
      .replace(/\{\{port\}\}/g, String(template.port));
  };

  const resolvedCommand = resolveSecondPass(command);
  const connectionString = template.connectionString
    ? resolveSecondPass(template.connectionString)
    : "";
  const healthCheck = template.healthCheck
    ? resolveSecondPass(template.healthCheck)
    : "";

  const volumes: Record<string, string> = {};
  for (const [mountPath, suffix] of Object.entries(template.volumes)) {
    volumes[mountPath] = `${serviceName}-${suffix}`;
  }

  return {
    image,
    containerName,
    env,
    volumes,
    port: template.port,
    command: resolvedCommand,
    connectionString,
    healthCheck,
    labels: {
      "managed-by": "hoist",
      "hoist.service": serviceName,
    },
  };
}
