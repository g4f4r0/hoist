import type { Template } from "../template.js";

export const mariadb: Template = {
  name: "mariadb",
  description: "MariaDB relational database",
  image: "mariadb:{{version}}",
  defaultVersion: "11",
  port: 3306,
  volumes: { "/var/lib/mysql": "data" },
  env: {
    MYSQL_ROOT_PASSWORD: "{{generate:password}}",
    MYSQL_USER: "{{generate:username}}",
    MYSQL_PASSWORD: "{{generate:password}}",
    MYSQL_DATABASE: "app",
  },
  connectionString:
    "mysql://{{env:MYSQL_USER}}:{{env:MYSQL_PASSWORD}}@{{container}}:{{port}}/{{env:MYSQL_DATABASE}}",
  healthCheck: "mysqladmin ping -u {{env:MYSQL_USER}} -p{{env:MYSQL_PASSWORD}}",
};
