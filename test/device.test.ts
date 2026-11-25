import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { silentLogger } from '../src/logger.js';
import { createLlm } from '../src/llm/create.js';
import type { LlmClient } from '../src/llm/types.js';
import type { Runtime } from '../src/runtime.js';
import { Store } from '../src/store.js';
import { createTools } from '../src/tools/registry.js';
import { chooseEngine, defaultEngine, parseSlashCommand, parseToolCall, parseWhen, WEBGPU_FALLBACK } from '../src/web/device.js';
import { WebChannel } from '../src/web/channel.js';
import { ScriptedLlm } from './helpers.js';

const NOW = new Date('2026-11-25T17:00:00.000Z');

function webApp(options?: { llm?: LlmClient; env?: Record<string, string> }) {
  const config = loadConfig({
    CHANNEL: 'web',
    APP_PASSWORD: 'correct-horse',
    LLM_MODE: 'mock',
    DATABASE_PATH: ':memory:',
    OWNER_NAME: 'Omar',
    ASSISTANT_NAME: 'Sable',
    OWNER_TIMEZONE: 'America/Los_Angeles',
    PORT: '8787',
    ...options?.env,
  } as NodeJS.ProcessEnv);
  const channel = new WebChannel();
  const runtime: Runtime = {
    config,
    store: Store.open(':memory:'),
    llm: options?.llm ?? createLlm(config),
    channel,
    log: silentLogger,
    tools: createTools(),
    now: () => NOW,
    fetchImpl: fetch,
  };
  return { ...createApp(runtime), store: runtime.store, llm: runtime.llm };
}

async function cookieFor(app: ReturnType<typeof webApp>['app']): Promise<string> {
  const response = await app.request('/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.50' },
    body: JSON.stringify({ password: 'correct-horse' }),
  });
  const header = response.headers.get('set-cookie') ?? '';
  const match = header.match(/sable_session=([a-f0-9]{64})/);
  if (!match) throw new Error('no cookie');
  return `sable_session=${match[1]}`;
}

describe('on-device mode selection', () => {
  it('defaults to the browser when no API key is set', async () => {
    const { app } = webApp();
    const cookie = await cookieFor(app);
    const response = await app.request('/api/config', { headers: { cookie } });
    const body = (await response.json()) as {
      defaultEngine: string;
      serverAvailable: boolean;
      models: { id: string; sizeMb: number; tier: string }[];
      webgpuMessage: string;
    };
    expect(body.defaultEngine).toBe('device');
    expect(body.serverAvailable).toBe(false);
    expect(body.models.map((model) => model.id)).toEqual([
      'Qwen2.5-0.5B-Instruct-q4f16_1-MLC',
      'Llama-3.2-1B-Instruct-q4f16_1-MLC',
      'Llama-3.2-3B-Instruct-q4f16_1-MLC',
    ]);
    expect(body.models.find((model) => model.tier === 'phone' && model.sizeMb === 879)?.id).toContain('1B');
    expect(body.models.find((model) => model.tier === 'computer')?.sizeMb).toBe(2264);
    expect(body.webgpuMessage).toBe(WEBGPU_FALLBACK);
    expect(body.webgpuMessage).toContain('iOS 26');
    expect(body.webgpuMessage).toContain('Chrome');

    const page = await app.request('/', { headers: { cookie } });
    const html = await page.text();
    expect(html).toContain('Downloading the on-device model');
    expect(html).toContain('iOS 26');
    expect(html).toContain('id="settings"');
  });

  it('defaults to the hosted model when a server key is set', async () => {
    const { app } = webApp({ env: { LLM_API_KEY: 'sk-test-value', LLM_MODE: 'openai' } });
    const cookie = await cookieFor(app);
    const configResponse = await app.request('/api/config', { headers: { cookie } });
    const body = (await configResponse.json()) as {
      defaultEngine: string;
      serverAvailable: boolean;
    };
    expect(body.defaultEngine).toBe('server');
    expect(body.serverAvailable).toBe(true);
    expect(defaultEngine(true)).toBe('server');
    expect(defaultEngine(false)).toBe('device');
  });

  it('falls back to the hosted model only when WebGPU is missing and a key exists', () => {
    expect(chooseEngine({ defaultEngine: 'device', saved: null, webgpu: false, serverAvailable: false })).toEqual({
      engine: 'device',
      reason: 'no-webgpu',
    });
    expect(chooseEngine({ defaultEngine: 'device', saved: null, webgpu: false, serverAvailable: true })).toEqual({
      engine: 'server',
      reason: 'no-webgpu',
    });
    expect(chooseEngine({ defaultEngine: 'server', saved: 'device', webgpu: true, serverAvailable: true })).toEqual({
      engine: 'device',
    });
    expect(chooseEngine({ defaultEngine: 'device', saved: 'server', webgpu: true, serverAvailable: false })).toEqual({
      engine: 'device',
    });
  });
});

describe('on-device tools', () => {
  it('saves a note from a slash command without calling a model', async () => {
    const llm = new ScriptedLlm([]);
    const { app, store } = webApp({ llm });
    const cookie = await cookieFor(app);
    const response = await app.request('/api/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ text: '/note oat milk' }),
    });
    const body = (await response.json()) as { needsModel: boolean; items: { body: string }[] };
    expect(body.needsModel).toBe(false);
    expect(body.items.at(-1)?.body).toContain('oat milk');
    expect(store.listNotes('web').map((note) => note.body)).toEqual(['oat milk']);
    expect(llm.requests).toHaveLength(0);
  });

  it('asks before a slash reminder and creates it only after yes', async () => {
    const llm = new ScriptedLlm([]);
    const { app, store } = webApp({ llm });
    const cookie = await cookieFor(app);
    const asked = await app.request('/api/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ text: '/remind in 5 minutes | stretch' }),
    });
    const askedBody = (await asked.json()) as { needsModel: boolean; pending: { summaries: string[] } | null };
    expect(askedBody.needsModel).toBe(false);
    expect(askedBody.pending?.summaries.join(' ')).toContain('stretch');
    expect(store.listReminders('web', true)).toHaveLength(0);

    const page = await app.request('/', { headers: { cookie } });
    expect(await page.text()).toContain('data-decision="yes"');

    const approved = await app.request('/api/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ text: 'yes' }),
    });
    const approvedBody = (await approved.json()) as { needsModel: boolean; items: { body: string }[] };
    expect(approvedBody.needsModel).toBe(false);
    expect(approvedBody.items.at(-1)?.body).toContain('stretch');
    expect(store.listReminders('web')).toHaveLength(1);
    expect(llm.requests).toHaveLength(0);
  });

  it('relays a plain tool immediately and holds a sensitive one for approval', async () => {
    const { app, store } = webApp({ llm: new ScriptedLlm([]) });
    const cookie = await cookieFor(app);
    const noted = await app.request('/api/device-reply', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ text: '{"tool":"add_note","arguments":{"text":"window seat","todo":true}}' }),
    });
    const notedBody = (await noted.json()) as { pending: unknown; items: { body: string }[] };
    expect(notedBody.pending).toBeNull();
    expect(store.listNotes('web')[0]?.body).toBe('window seat');
    expect(notedBody.items.at(-1)?.body).toContain('window seat');

    const reminder = await app.request('/api/device-reply', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        text: '```json\n{"tool":"create_reminder","arguments":{"message":"Call the dentist","remind_at":"2026-11-26T17:00:00.000Z"}}\n```',
      }),
    });
    const reminderBody = (await reminder.json()) as { pending: { summaries: string[] } | null };
    expect(reminderBody.pending?.summaries.join(' ')).toContain('Call the dentist');
    expect(store.listReminders('web', true)).toHaveLength(0);

    const plain = await app.request('/api/device-reply', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ text: 'Soup is a good weeknight dinner.' }),
    });
    const plainBody = (await plain.json()) as { items: { body: string }[] };
    expect(plainBody.items.at(-1)?.body).toBe('Soup is a good weeknight dinner.');
  });

  it('parses times, commands, and tool JSON', () => {
    expect(parseWhen('in 5 minutes', NOW, 'America/Los_Angeles')?.toISOString()).toBe('2026-11-25T17:05:00.000Z');
    expect(parseWhen('tomorrow 9am', NOW, 'America/Los_Angeles')?.toISOString()).toBe('2026-11-26T17:00:00.000Z');
    expect(parseSlashCommand('/todo call the clinic')).toEqual({ kind: 'note', text: 'call the clinic', todo: true });
    expect(parseSlashCommand('hello')).toBeNull();
    expect(parseToolCall('Sure. {"tool":"add_note","arguments":{"text":"x"}}')).toBeNull();
    expect(parseToolCall('{"tool":"add_note","arguments":{"text":"x"}}')?.name).toBe('add_note');
  });
});
