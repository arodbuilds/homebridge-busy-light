/** The logger every module writes to. Homebridge's Logging fits it, and so does the CLI's console logger. */
export interface Log {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  debug(message: string): void;
}

/** With the plugin's `debug` option on, debug lines are written at info level so they show without `homebridge -D`. */
export function withDebug(log: Log, debug: boolean): Log {
  if (!debug) {
    return log;
  }
  return {
    info: (m) => log.info(m),
    warn: (m) => log.warn(m),
    error: (m) => log.error(m),
    debug: (m) => log.info(m),
  };
}
