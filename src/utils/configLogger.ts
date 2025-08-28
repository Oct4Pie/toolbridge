export interface Logger {
  debug: (...args: unknown[]) => void;
  log: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
}

export function debug(debugMode: boolean, ...args: unknown[]): void {
  if (debugMode) {
    try {
      process.stdout.write(args.map(a => String(a)).join(' ') + '\n');
    } catch {
      // fallback to noop
    }
  }
}

export function error(...args: unknown[]): void {
  try {
    process.stderr.write(args.map(a => String(a)).join(' ') + '\n');
  } catch {
    // fallback to noop
  }
}

export function warn(...args: unknown[]): void {
  try {
    process.stderr.write(args.map(a => String(a)).join(' ') + '\n');
  } catch {
    // fallback to noop
  }
}

export function info(...args: unknown[]): void {
  try {
    process.stdout.write(args.map(a => String(a)).join(' ') + '\n');
  } catch {
    // fallback to noop
  }
}

export function createLogger(debugMode: boolean | string = false): Logger {
  const isDebugEnabled = typeof debugMode === 'string' ? debugMode === 'true' : Boolean(debugMode);
  
  return {
    debug: (...args: unknown[]) => debug(isDebugEnabled, ...args),
    log: (...args: unknown[]) => debug(isDebugEnabled, ...args),
    error,
    warn,
    info,
  };
}

export default { debug, error, warn, info, createLogger };