import type { Template } from "../template.js";

export const postgres: Template = {
  name: "postgres",
  description: "PostgreSQL relational database",
  image: "postgres:{{version}}-alpine",
  defaultVersion: "16",
  port: 5432,
  volumes: { "/var/lib/postgresql/data": "data" },
  env: {
    POSTGRES_USER: "{{generate:username}}",
    POSTGRES_PASSWORD: "{{generate:password}}",
    POSTGRES_DB: "app",
  },
  connectionString:
    "postgresql://{{env:POSTGRES_USER}}:{{env:POSTGRES_PASSWORD}}@{{container}}:{{port}}/{{env:POSTGRES_DB}}",
  healthCheck: "pg_isready -U {{env:POSTGRES_USER}}",
};
