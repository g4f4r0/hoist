import type { Template } from "../template.js";

export const redis: Template = {
  name: "redis",
  description: "Redis in-memory data store",
  image: "redis:{{version}}-alpine",
  defaultVersion: "7",
  port: 6379,
  volumes: { "/data": "data" },
  env: {
    REDIS_PASSWORD: "{{generate:password}}",
  },
  command: "redis-server --requirepass {{env:REDIS_PASSWORD}}",
  connectionString: "redis://:{{env:REDIS_PASSWORD}}@{{container}}:{{port}}",
  healthCheck: "redis-cli -a {{env:REDIS_PASSWORD}} ping",
};
