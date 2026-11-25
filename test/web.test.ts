import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { silentLogger } from '../src/logger.js';
import { createLlm } from '../src/llm/create.js';
import type { ChatResult, LlmClient } from '../src/llm/types.js';
import type { Runtime } from '../src/runtime.js';
import { Store } from '../src/store.js';
import { createTools } from '../src/tools/registry.js';
import { WebChannel } from '../src/web/channel.js';
import { ScriptedLlm } from './helpers.js';

const PASSWORD = 'correct-horse';

function webApp(options?: { llm?: LlmClient; password?: string; now?: () => Date }) {
  const config = loadConfig({
    CHANNEL: 'web',
    APP_PASSWORD: options?.password ?? PASSWORD,
    LLM_MODE: 'mock',
    DATABASE_PATH: ':memory:',
    OWNER_NAME: 'Omar',
    ASSISTANT_NAME: 'Sable',
    OWNER_TIMEZONE: 'America/Los_Angeles',
    PORT: '8787',
  } as NodeJS.ProcessEnv);
  const channel = new WebChannel();
  const runtime: Runtime = {
    config,
    store: Store.open(':memory:'),
    llm: options?.llm ?? createLlm(config),
    channel,
    log: silentLogger,
    tools: createTools(),
    now: options?.now ?? (() => new Date('2026-11-25T17:00:00.000Z')),
    fetchImpl: fetch,
  };
  const created = createApp(runtime);
  return { ...created, store: runtime.store, channel, runtime };
}

async function login(app: ReturnType<typeof webApp>['app'], password = PASSWORD, ip = '203.0.113.10') {
  return app.request('/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify({ password }),
  });
}

function sessionCookie(response: Response): string {
  const header = response.headers.get('set-cookie') ?? '';
  const match = header.match(/sable_session=([a-f0-9]{64})/);
  if (!match) throw new Error(`missing session cookie: ${header}`);
  return `sable_session=${match[1]}`;
}

describe('web login', () => {
  it('shows a private login page and refuses chat until the password matches', async () => {
    const { app } = webApp();
    const page = await app.request('/');
    const html = await page.text();
    expect(html).toContain('There is no sign-up');
    expect(html).toContain('type="password"');
    expect(html).not.toContain(PASSWORD);
    expect(html).not.toContain('id="composer"');

    const denied = await app.request('/api/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'Hello', engine: 'server' }),
    });
    expect(denied.status).toBe(401);

    const wrong = await login(app, 'correct-horse-nope');
    expect(wrong.status).toBe(401);
    expect(await wrong.text()).not.toContain('correct-horse-nope');
    expect(wrong.headers.get('set-cookie')).toBeNull();
  });

  it('accepts a same-origin browser form and rejects a cross-site post', async () => {
    const { app } = webApp();
    const same = await app.request('/login', {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        origin: 'null',
        'sec-fetch-site': 'same-origin',
      },
      body: `password=${encodeURIComponent(PASSWORD)}`,
    });
    expect(same.status).toBe(303);

    const cross = await app.request('/login', {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        origin: 'https://evil.example',
        'sec-fetch-site': 'cross-site',
      },
      body: 'password=nope',
    });
    expect(cross.status).toBe(403);
  });

  it('sets an httpOnly session cookie and rate limits repeated failures', async () => {
    const { app } = webApp();
    const ok = await login(app);
    expect(ok.status).toBe(200);
    const setCookie = ok.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Lax');
    expect(setCookie.toLowerCase()).not.toContain(PASSWORD);

    const limited = webApp();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const failed = await login(limited.app, 'nope', '198.51.100.8');
      expect(failed.status).toBe(401);
    }
    const blocked = await login(limited.app, PASSWORD, '198.51.100.8');
    expect(blocked.status).toBe(429);
  });
});

describe('web chat', () => {
  it('round-trips a message and keeps it after reload', async () => {
    const { app } = webApp();
    const cookie = sessionCookie(await login(app));
    const sent = await app.request('/api/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ text: 'Hello', engine: 'server' }),
    });
    expect(sent.status).toBe(200);
    const body = (await sent.json()) as { items: { role: string; body: string }[] };
    expect(body.items.map((item) => item.body)).toEqual(['Hello', 'You said: Hello']);

    const reloaded = await app.request('/', { headers: { cookie } });
    const html = await reloaded.text();
    expect(html).toContain('Hello');
    expect(html).toContain('You said: Hello');
    expect(html).toContain('id="composer"');
  });

  it('passes a photo to the model', async () => {
    const { app } = webApp();
    const cookie = sessionCookie(await login(app, PASSWORD, '203.0.113.20'));
    const sent = await app.request('/api/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        text: 'What is this?',
        engine: 'server',
        image: { mimeType: 'image/png', data: Buffer.from('png').toString('base64') },
      }),
    });
    const body = (await sent.json()) as { items: { body: string }[] };
    expect(body.items.at(-1)?.body).toContain('I can see the photo');
  });

  it('renders YES and NO buttons and runs the reminder only after yes', async () => {
    const llm = new ScriptedLlm([
      {
        content: null,
        toolCalls: [
          {
            id: 'call_reminder',
            name: 'create_reminder',
            arguments: { message: 'Call the dentist', remind_at: '2026-11-26T17:00:00.000Z' },
          },
        ],
      } satisfies ChatResult,
      { content: 'Reminder set.', toolCalls: [] },
    ]);
    const { app, store } = webApp({ llm, now: () => new Date('2026-11-25T17:00:00.000Z') });
    const cookie = sessionCookie(await login(app, PASSWORD, '203.0.113.30'));
    const asked = await app.request('/api/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ text: 'Remind me to call the dentist tomorrow at 9', engine: 'server' }),
    });
    const askedBody = (await asked.json()) as { pending: { summaries: string[] } | null };
    expect(askedBody.pending?.summaries.join('\n')).toContain('Call the dentist');
    expect(store.listReminders('web', true)).toHaveLength(0);

    const page = await app.request('/', { headers: { cookie } });
    const html = await page.text();
    expect(html).toContain('data-decision="yes"');
    expect(html).toContain('data-decision="no"');
    expect(html).toContain('Call the dentist');

    const approved = await app.request('/api/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ text: 'yes', engine: 'server' }),
    });
    const approvedBody = (await approved.json()) as { items: { body: string }[]; pending: unknown };
    expect(approvedBody.items.at(-1)?.body).toBe('Reminder set.');
    expect(approvedBody.pending).toBeNull();
    expect(store.listReminders('web')).toHaveLength(1);
  });

  it('does not create the reminder when No is tapped', async () => {
    const llm = new ScriptedLlm([
      {
        content: null,
        toolCalls: [
          {
            id: 'call_reminder',
            name: 'create_reminder',
            arguments: { message: 'Call the dentist', remind_at: '2026-11-26T17:00:00.000Z' },
          },
        ],
      },
    ]);
    const { app, store } = webApp({ llm, now: () => new Date('2026-11-25T17:00:00.000Z') });
    const cookie = sessionCookie(await login(app, PASSWORD, '203.0.113.31'));
    await app.request('/api/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ text: 'Remind me', engine: 'server' }),
    });
    const declined = await app.request('/api/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ text: 'no', engine: 'server' }),
    });
    const body = (await declined.json()) as { items: { body: string }[] };
    expect(body.items.at(-1)?.body).toBe("Okay, I won't do that.");
    expect(store.listReminders('web', true)).toHaveLength(0);
  });

  it('shows a due reminder in the chat', async () => {
    const harness = webApp({ now: () => new Date('2026-11-26T18:00:00.000Z') });
    const cookie = sessionCookie(await login(harness.app, PASSWORD, '203.0.113.40'));
    harness.store.addReminder('web', 'Stretch', new Date('2026-11-26T17:00:00.000Z'));
    expect(await harness.runScheduler()).toBe(1);
    const page = await harness.app.request('/', { headers: { cookie } });
    expect(await page.text()).toContain('Reminder: Stretch');
  });
});
