import chalk from "chalk";

let jsonMode = false;
let autoConfirm = false;

/** Enables or disables JSON output mode. */
export function setJsonMode(enabled: boolean): void {
  jsonMode = enabled;
}

/** Returns true when JSON output mode is active. */
export function isJsonMode(): boolean {
  return jsonMode;
}

/** Enables or disables auto-confirm mode (skip interactive confirmations). */
export function setAutoConfirm(enabled: boolean): void {
  autoConfirm = enabled;
}

/** Returns true when auto-confirm mode is active (non-TTY / agent context). */
export function isAutoConfirm(): boolean {
  return autoConfirm;
}

/** Writes data as formatted JSON to stdout. */
export function outputJson(data: unknown): void {
  console.log(JSON.stringify(data, null, 2));
}

/** Outputs a success result as JSON to stdout or human-readable to stderr. */
export function outputSuccess(message: string, data?: unknown): void {
  if (jsonMode) {
    outputJson({ status: "success", message, ...(data ? { data } : {}) });
  } else {
    console.error(chalk.green("✓"), message);
  }
}

/** Outputs an error result as JSON to stdout or human-readable to stderr. */
export function outputError(message: string, details?: unknown): void {
  if (jsonMode) {
    outputJson({
      status: "error",
      message,
      ...(details ? { details } : {}),
    });
  } else {
    console.error(chalk.red("✗"), message);
  }
}

/** Writes an informational message to stderr in human mode only. */
export function outputInfo(message: string): void {
  if (!jsonMode) {
    console.error(chalk.blue("ℹ"), message);
  }
}
