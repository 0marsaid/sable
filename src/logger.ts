export type LogFields = Record<string, unknown>;

export type Logger = {
  debug: (fields: LogFields, msg: string) => void;
  info: (fields: LogFields, msg: string) => void;
  warn: (fields: LogFields, msg: string) => void;
  error: (fields: LogFields, msg: string) => void;
};

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 } as const;
type Level = keyof typeof LEVELS;

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export function redactText(input: string, secrets: readonly string[]): string {
  let out = input;
  for (const secret of secrets) {
    if (secret.length < 6) continue;
    if (out.includes(secret)) out = out.split(secret).join('[redacted]');
  }
  return out;
}

export function createLogger(options: { level: string; secrets: string[] }): Logger {
  const threshold = LEVELS[options.level as Level] ?? LEVELS.info;
  const secrets = options.secrets.filter((secret) => secret.length >= 6);

  function write(level: Level, fields: LogFields, msg: string): void {
    if (LEVELS[level] < threshold) return;
    const line = redactText(
      JSON.stringify({ time: new Date().toISOString(), level, msg, ...fields }),
      secrets,
    );
    if (level === 'error') console.error(line);
    else console.log(line);
  }

  return {
    debug: (fields, msg) => write('debug', fields, msg),
    info: (fields, msg) => write('info', fields, msg),
    warn: (fields, msg) => write('warn', fields, msg),
    error: (fields, msg) => write('error', fields, msg),
  };
}

export const silentLogger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};
