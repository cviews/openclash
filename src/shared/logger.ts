type LogLevel = "debug" | "info" | "warn" | "error" | "silent";

const LEVELS: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3, silent: 4 };

let currentLevel: LogLevel = (process.env["OPENCLASH_LOG_LEVEL"] as LogLevel) ?? "info";

function shouldLog(level: LogLevel): boolean {
  return LEVELS[level]! >= LEVELS[currentLevel]!;
}

function format(level: LogLevel, tag: string, message: string): string {
  const ts = new Date().toISOString();
  return `${ts} [${level.toUpperCase()}] [${tag}] ${message}`;
}

export const logger = {
  setLevel(level: LogLevel) {
    currentLevel = level;
  },

  /** Suppress all output (for plugin mode) */
  silence() {
    currentLevel = "silent";
  },

  debug(tag: string, message: string) {
    if (shouldLog("debug")) console.debug(format("debug", tag, message));
  },

  info(tag: string, message: string) {
    if (shouldLog("info")) console.info(format("info", tag, message));
  },

  warn(tag: string, message: string) {
    if (shouldLog("warn")) console.warn(format("warn", tag, message));
  },

  error(tag: string, message: string, err?: unknown) {
    if (shouldLog("error")) {
      const suffix = err instanceof Error ? `: ${err.message}` : err ? `: ${String(err)}` : "";
      console.error(format("error", tag, message + suffix));
    }
  },
};
