import type { Template } from "../template.js";
import { postgres } from "./postgres.js";
import { mysql } from "./mysql.js";
import { mariadb } from "./mariadb.js";
import { redis } from "./redis.js";
import { mongodb } from "./mongodb.js";

const TEMPLATES: Record<string, Template> = {
  postgres,
  mysql,
  mariadb,
  redis,
  mongodb,
};

/** Get a built-in template by name. */
export function getTemplate(name: string): Template {
  const template = TEMPLATES[name];
  if (!template) {
    throw new Error(`unknown template: ${name}`);
  }
  return template;
}

/** List all built-in templates. */
export function listTemplates(): Template[] {
  return Object.values(TEMPLATES);
}
