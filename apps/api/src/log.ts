// Structured JSON logger. One log line = one JSON object. Fields are
// stable — downstream (Cloud Logging / SIEM) depends on them.
// Per CLAUDE.md: users never see these; super-admin sees everything.

export type Level = "trace" | "debug" | "info" | "warn" | "error";

const ORDER: Level[] = ["trace", "debug", "info", "warn", "error"];

export interface LogFields {
  [key: string]: unknown;
}

export class Logger {
  constructor(
    private readonly minLevel: Level,
    private readonly base: LogFields = {},
  ) {}

  child(extra: LogFields): Logger {
    return new Logger(this.minLevel, { ...this.base, ...extra });
  }

  private emit(level: Level, msg: string, fields?: LogFields): void {
    if (ORDER.indexOf(level) < ORDER.indexOf(this.minLevel)) return;
    const line = {
      ts: new Date().toISOString(),
      level,
      msg,
      ...this.base,
      ...fields,
    };
    const text = JSON.stringify(line);
    if (level === "error" || level === "warn") {
      console.error(text);
    } else {
      console.log(text);
    }
  }

  trace(msg: string, f?: LogFields): void { this.emit("trace", msg, f); }
  debug(msg: string, f?: LogFields): void { this.emit("debug", msg, f); }
  info(msg: string, f?: LogFields): void { this.emit("info", msg, f); }
  warn(msg: string, f?: LogFields): void { this.emit("warn", msg, f); }
  error(msg: string, f?: LogFields): void { this.emit("error", msg, f); }
}
