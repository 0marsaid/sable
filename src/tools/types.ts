import type { SearchProviderName } from '../config.js';
import type { ToolSchema } from '../llm/types.js';
import type { LookupFn } from '../net/safeUrl.js';
import type { Store } from '../store.js';

export type ToolContext = {
  phone: string;
  now: Date;
  timezone: string;
  store: Store;
  fetchImpl: typeof fetch;
  searchProvider: SearchProviderName;
  tavilyApiKey: string;
  braveApiKey: string;
  /** Override DNS for tests. Production resolves the host and rejects private addresses. */
  lookupImpl?: LookupFn;
};

export type Tool = ToolSchema & {
  /** When true, Sable texts a summary and waits for YES before execute(). */
  sensitive: boolean;
  summarize: (args: Record<string, unknown>, ctx: ToolContext) => string;
  /** Return an error string to skip execution and hand the error back to the model. */
  validate?: (args: Record<string, unknown>, ctx: ToolContext) => string | null;
  execute: (args: Record<string, unknown>, ctx: ToolContext) => Promise<string>;
};

export function clip(text: string, max = 6000): string {
  const clean = text.replace(/\s+\n/g, '\n').trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max)}\n…(truncated)`;
}

export function requiredText(args: Record<string, unknown>, key: string, label = key): string | null {
  const value = args[key];
  if (typeof value !== 'string' || !value.trim()) return `${label} is required.`;
  return null;
}

export function requiredId(args: Record<string, unknown>): number | null {
  const value = args.id;
  const id = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isInteger(id) || id <= 0) return null;
  return id;
}
