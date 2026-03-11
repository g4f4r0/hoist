import type { Template } from "../template.js";

export const mongodb: Template = {
  name: "mongodb",
  description: "MongoDB document database",
  image: "mongo:{{version}}",
  defaultVersion: "7",
  port: 27017,
  volumes: { "/data/db": "data" },
  env: {
    MONGO_INITDB_ROOT_USERNAME: "{{generate:username}}",
    MONGO_INITDB_ROOT_PASSWORD: "{{generate:password}}",
    MONGO_INITDB_DATABASE: "app",
  },
  connectionString:
    "mongodb://{{env:MONGO_INITDB_ROOT_USERNAME}}:{{env:MONGO_INITDB_ROOT_PASSWORD}}@{{container}}:{{port}}/{{env:MONGO_INITDB_DATABASE}}?authSource=admin",
  healthCheck: `mongosh --eval "db.runCommand('ping')"`,
};
