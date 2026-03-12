import chalk from "chalk";

export interface NextStep {
  actor: "user" | "agent";
  action: string;
  command?: string;
}

function isTTY(): boolean {
  return process.stdout.isTTY === true;
}

/** Emits a progress event as NDJSON for agents or a spinner line for humans. */
export function outputProgress(phase: string, message: string): void {
  if (isTTY()) {
    process.stderr.write(`${chalk.cyan("⠋")} ${chalk.dim(phase)} ${message}\n`);
    return;
  }
  console.log(JSON.stringify({
    type: "progress",
    phase,
    message,
    timestamp: new Date().toISOString(),
  }));
}

/** Emits a result as NDJSON for agents or formatted output for humans. */
export function outputResult(data: unknown, next?: NextStep): void {
  if (isTTY()) {
    printHuman(data, next);
    return;
  }
  console.log(JSON.stringify({
    type: "result",
    status: "success",
    data,
    ...(next ? { next } : {}),
  }));
}

/** Emits an error as NDJSON for agents or formatted output for humans. */
export function outputError(message: string, details?: unknown, next?: NextStep): void {
  if (isTTY()) {
    process.stderr.write(`\n${chalk.red("✘")} ${chalk.bold(message)}\n`);
    if (details) {
      const detailStr = typeof details === "string" ? details : JSON.stringify(details);
      process.stderr.write(`  ${chalk.dim(detailStr)}\n`);
    }
    if (next) {
      printNext(next);
    }
    process.stderr.write("\n");
    return;
  }
  console.log(JSON.stringify({
    type: "error",
    message,
    ...(details ? { details } : {}),
    ...(next ? { next } : {}),
  }));
}

function printNext(next: NextStep): void {
  if (next.command) {
    process.stderr.write(`\n  ${chalk.dim("→")} ${chalk.yellow(next.command)}\n`);
  } else if (next.actor === "user") {
    process.stderr.write(`\n  ${chalk.dim("→")} ${next.action}\n`);
  }
}

function printHuman(data: unknown, next?: NextStep): void {
  if (data === null || data === undefined) {
    return;
  }

  if (Array.isArray(data)) {
    if (data.length === 0) {
      console.log(chalk.dim("  (none)"));
    } else {
      printTable(data);
    }
  } else if (typeof data === "object") {
    printObject(data as Record<string, unknown>);
  } else {
    console.log(String(data));
  }

  if (next) {
    printNext(next);
  }
  console.log();
}

function printObject(obj: Record<string, unknown>): void {
  const status = obj.status as string | undefined;
  if (status) {
    const icon = status === "ready" || status === "success" || status === "healthy" || status === "valid"
      ? chalk.green("✓")
      : status === "needs_provider" || status === "unhealthy"
        ? chalk.yellow("!")
        : chalk.blue("•");
    console.log(`\n  ${icon} ${chalk.bold(status)}`);
  }

  for (const [key, value] of Object.entries(obj)) {
    if (key === "status") continue;
    if (value === undefined || value === null) continue;

    if (Array.isArray(value)) {
      if (value.length === 0) continue;
      console.log(`\n  ${chalk.dim(key)}:`);
      if (value.length > 0 && typeof value[0] === "object") {
        printTable(value, "    ");
      } else {
        for (const item of value) {
          console.log(`    ${item}`);
        }
      }
    } else if (typeof value === "object") {
      console.log(`\n  ${chalk.dim(key)}:`);
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        console.log(`    ${chalk.dim(k)}: ${formatValue(v)}`);
      }
    } else {
      console.log(`  ${chalk.dim(key)}: ${formatValue(value)}`);
    }
  }
}

function printTable(rows: unknown[], indent = "  "): void {
  if (rows.length === 0) return;

  const objects = rows as Array<Record<string, unknown>>;
  const keys = Object.keys(objects[0]).filter((k) => {
    return objects.some((row) => row[k] !== undefined && row[k] !== null && row[k] !== "");
  });

  const widths = keys.map((key) => {
    const values = objects.map((row) => formatCell(row[key]));
    return Math.max(key.length, ...values.map((v) => v.length));
  });

  const header = keys.map((k, i) => chalk.dim(k.padEnd(widths[i]))).join("  ");
  console.log(`${indent}${header}`);

  for (const row of objects) {
    const line = keys.map((k, i) => {
      const val = formatCell(row[k]);
      return colorCell(k, val).padEnd(widths[i] + (colorCell(k, val).length - val.length));
    }).join("  ");
    console.log(`${indent}${line}`);
  }
}

function formatCell(value: unknown): string {
  if (value === true) return "✓";
  if (value === false) return "—";
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function colorCell(key: string, value: string): string {
  if (key === "status" || key === "ok" || key === "default" || key === "healthy") {
    if (value === "✓" || value === "true" || value === "running" || value === "ready" || value === "pass" || value === "added" || value === "updated") {
      return chalk.green(value);
    }
    if (value === "—" || value === "false" || value === "stopped" || value === "failed" || value === "fail") {
      return chalk.red(value);
    }
    if (value === "warn" || value === "skip") return chalk.yellow(value);
  }
  return value;
}

function formatValue(value: unknown): string {
  if (typeof value === "boolean") return value ? chalk.green("yes") : chalk.red("no");
  if (typeof value === "number") return chalk.white(String(value));
  return String(value);
}
