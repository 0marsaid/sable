import type { Hono } from 'hono';
import { createApp, type SableApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { silentLogger } from '../src/logger.js';
import type { ChatRequest, ChatResult, LlmClient } from '../src/llm/types.js';
import type { Runtime } from '../src/runtime.js';
import { Store } from '../src/store.js';
import { createTools } from '../src/tools/registry.js';
import type { Channel, OutboxEntry } from '../src/whatsapp/types.js';

export class FakeChannel implements Channel {
  readonly id = 'console' as const;
  readonly outbox: OutboxEntry[] = [];
  readonly sent: { to: string; text: string; reminder?: boolean }[] = [];
  failTimes = 0;

  async sendText(to: string, text: string, options?: { reminder?: boolean }): Promise<void> {
    if (this.failTimes > 0) {
      this.failTimes -= 1;
      throw new Error('send failed');
    }
    this.sent.push({ to, text, reminder: options?.reminder });
    this.outbox.push({ to, text, at: new Date().toISOString() });
  }
}

export class ScriptedLlm implements LlmClient {
  readonly configured = true;
  readonly requests: ChatRequest[] = [];

  constructor(private readonly queue: ChatResult[]) {}

  async chat(input: ChatRequest): Promise<ChatResult> {
    this.requests.push(input);
    const next = this.queue.shift();
    if (!next) throw new Error('ScriptedLlm ran out of responses');
    return next;
  }
}

export function metaEnvelope(message: Record<string, unknown>): unknown {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        changes: [
          {
            value: {
              messaging_product: 'whatsapp',
              messages: [message],
            },
          },
        ],
      },
    ],
  };
}

export function textMessage(partial: { from?: string; id?: string; text: string }): Record<string, unknown> {
  return {
    from: partial.from ?? '15551234567',
    id: partial.id ?? 'wamid.1',
    timestamp: '1710000000',
    type: 'text',
    text: { body: partial.text },
  };
}

export type TestHarness = {
  app: Hono;
  drain: () => Promise<void>;
  runScheduler: () => Promise<number>;
  store: Store;
  channel: FakeChannel;
  llm: LlmClient;
  runtime: Runtime;
};

export function createTestApp(options?: {
  env?: Record<string, string>;
  llm?: LlmClient;
  channel?: FakeChannel;
  now?: () => Date;
  fetchImpl?: typeof fetch;
}): TestHarness {
  const config = loadConfig({
    OWNER_PHONE_NUMBERS: '+1 (555) 123-4567',
    OWNER_NAME: 'Omar',
    ASSISTANT_NAME: 'Sable',
    OWNER_TIMEZONE: 'America/Los_Angeles',
    DATABASE_PATH: ':memory:',
    META_VERIFY_TOKEN: 'verify-me',
    LLM_MODE: 'mock',
    LLM_MODEL: 'gpt-4o-mini',
    WHATSAPP_PROVIDER: 'console',
    PORT: '8787',
    LOG_LEVEL: 'error',
    ...options?.env,
  } as NodeJS.ProcessEnv);
  const channel = options?.channel ?? new FakeChannel();
  const llm = options?.llm ?? new ScriptedLlm([{ content: 'Hello Omar', toolCalls: [] }]);
  const runtime: Runtime = {
    config,
    store: Store.open(':memory:'),
    llm,
    channel,
    log: silentLogger,
    tools: createTools(),
    now: options?.now ?? (() => new Date('2026-11-25T17:00:00.000Z')),
    fetchImpl: options?.fetchImpl ?? fetch,
  };
  const created: SableApp = createApp(runtime);
  return {
    app: created.app,
    drain: created.drain,
    runScheduler: created.runScheduler,
    store: runtime.store,
    channel,
    llm,
    runtime,
  };
}

export async function postWebhook(app: Hono, body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return app.request('/webhook', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}
