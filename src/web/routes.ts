import type { Context, Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { streamSSE } from 'hono/streaming';
import { randomUUID } from 'node:crypto';
import { deliverToUser, handleInbound } from '../agent/handle.js';
import { pendingIsFresh } from '../agent/approval.js';
import { isRecord } from '../json.js';
import { WEB_USER } from '../phone.js';
import type { Runtime } from '../runtime.js';
import type { InboundMessage } from '../whatsapp/types.js';
import { LoginLimiter, PasswordGate, SESSION_COOKIE, SESSION_TTL_MS } from './auth.js';
import { isWebChannel } from './channel.js';
import { DEVICE_MODELS, WEBGPU_FALLBACK, defaultEngine } from './device.js';
import { handleDeviceReply, handleDeviceText } from './deviceTurn.js';
import { renderChatPage, renderLoginPage } from './page.js';

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

function clientIp(c: Context): string {
  const forwarded = c.req.header('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0]?.trim() || 'local';
  return c.req.header('x-real-ip') ?? 'local';
}

function httpsRequest(c: Context): boolean {
  const forwarded = c.req.header('x-forwarded-proto')?.split(',')[0]?.trim();
  if (forwarded) return forwarded === 'https';
  return new URL(c.req.url).protocol === 'https:';
}

function originAllowed(c: Context): boolean {
  // Browsers set this and pages cannot spoof it. A same-origin form can still
  // send Origin: null when the referrer policy strips it.
  if (c.req.header('sec-fetch-site') === 'same-origin') return true;
  const origin = c.req.header('origin');
  if (!origin || origin === 'null') return !c.req.header('sec-fetch-site');
  let originHost = '';
  try {
    originHost = new URL(origin).host;
  } catch {
    return false;
  }
  const host = c.req.header('host') ?? '';
  if (host && originHost === host) return true;
  try {
    if (originHost === new URL(c.req.url).host) return true;
  } catch {
    return false;
  }
  // A form on localhost may be opened as 127.0.0.1 while the request host is localhost, or the reverse.
  const loopback = (value: string) => /^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(value);
  const portOf = (value: string) => value.replace(/^\[[^\]]+\]/, '').split(':')[1] ?? '';
  return loopback(originHost) && loopback(host) && portOf(originHost) === portOf(host);
}

function cookieOptions(c: Context) {
  return {
    httpOnly: true,
    sameSite: 'Lax' as const,
    path: '/',
    secure: httpsRequest(c),
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  };
}

function signedIn(c: Context, runtime: Runtime): boolean {
  const id = getCookie(c, SESSION_COOKIE) ?? '';
  return runtime.store.sessionValid(id, runtime.now());
}

function chatState(runtime: Runtime) {
  const pending = runtime.store.getPending(WEB_USER);
  const fresh = pending && pendingIsFresh(pending.createdAt, runtime.now()) ? pending : null;
  return {
    items: runtime.store.transcript(WEB_USER, 80),
    pending: fresh ? { summaries: fresh.summaries } : null,
  };
}

function pageHeaders(c: Context): void {
  c.header('cache-control', 'no-store');
  c.header('x-content-type-options', 'nosniff');
  c.header('referrer-policy', 'strict-origin-when-cross-origin');
  c.header('x-frame-options', 'DENY');
}

type ImagePayload = { mimeType: string; base64: string };

function readImage(value: unknown): ImagePayload | { error: string } | null {
  if (value == null) return null;
  if (!isRecord(value)) return { error: 'That photo could not be read.' };
  const mimeType = typeof value.mimeType === 'string' ? value.mimeType.toLowerCase().split(';')[0].trim() : '';
  const data = typeof value.data === 'string' ? value.data.replace(/\s/g, '') : '';
  if (!mimeType && !data) return null;
  if (!IMAGE_TYPES.has(mimeType)) return { error: 'Send a JPEG, PNG, WebP, or GIF.' };
  if (data.length > 6_000_000) return { error: 'That photo is too large. Keep it under 4 MB.' };
  if (!/^[A-Za-z0-9+/=]+$/.test(data)) return { error: 'That photo could not be read.' };
  return { mimeType, base64: data };
}

function engineFor(runtime: Runtime): 'device' | 'server' {
  return runtime.config.llmApiKey && runtime.llm.configured ? 'server' : 'device';
}

export function registerWebRoutes(app: Hono, runtime: Runtime): void {
  const gate = new PasswordGate(runtime.config.appPassword);
  const limiter = new LoginLimiter();

  app.get('/', (c) => {
    pageHeaders(c);
    if (!signedIn(c, runtime)) {
      const error = c.req.query('error');
      const known = error === 'password' || error === 'rate' || error === 'missing' ? error : undefined;
      return c.html(
        renderLoginPage({
          assistantName: runtime.config.assistantName,
          ownerName: runtime.config.ownerName,
          passwordConfigured: gate.configured,
          error: !gate.configured && !known ? 'missing' : known,
        }),
      );
    }
    const state = chatState(runtime);
    return c.html(
      renderChatPage({
        assistantName: runtime.config.assistantName,
        ownerName: runtime.config.ownerName,
        timezone: runtime.config.timezone,
        items: state.items,
        pending: state.pending,
      }),
    );
  });

  app.post('/login', async (c) => {
    if (!originAllowed(c)) {
      runtime.log.warn(
        { origin: c.req.header('origin') ?? '', host: c.req.header('host') ?? '', url: c.req.url },
        'rejected web write',
      );
      return c.text('Forbidden', 403);
    }
    const wantsJson = (c.req.header('content-type') ?? '').includes('application/json');
    const ip = clientIp(c);
    const now = runtime.now().getTime();
    if (limiter.blocked(ip, now)) {
      if (wantsJson) return c.json({ error: 'Too many tries. Wait a few minutes and try again.' }, 429);
      return c.redirect('/?error=rate', 303);
    }
    let password = '';
    if (wantsJson) {
      const body: unknown = await c.req.json().catch(() => null);
      password = isRecord(body) && typeof body.password === 'string' ? body.password : '';
    } else {
      const form = await c.req.parseBody();
      password = typeof form.password === 'string' ? form.password : '';
    }
    if (!gate.check(password)) {
      limiter.fail(ip, now);
      runtime.log.warn({ ip }, 'failed web login');
      if (wantsJson) return c.json({ error: 'Wrong password.' }, 401);
      return c.redirect(gate.configured ? '/?error=password' : '/?error=missing', 303);
    }
    limiter.succeed(ip);
    const id = runtime.store.createSession(runtime.now(), SESSION_TTL_MS);
    setCookie(c, SESSION_COOKIE, id, cookieOptions(c));
    if (wantsJson) return c.json({ ok: true });
    return c.redirect('/', 303);
  });

  app.post('/logout', (c) => {
    const id = getCookie(c, SESSION_COOKIE) ?? '';
    if (id) runtime.store.deleteSession(id);
    deleteCookie(c, SESSION_COOKIE, { path: '/' });
    return c.redirect('/', 303);
  });

  app.get('/api/config', (c) => {
    if (!signedIn(c, runtime)) return c.json({ error: 'Sign in again.' }, 401);
    const serverAvailable = Boolean(runtime.config.llmApiKey) && runtime.llm.configured;
    return c.json({
      defaultEngine: defaultEngine(serverAvailable),
      serverAvailable,
      models: DEVICE_MODELS,
      webgpuMessage: WEBGPU_FALLBACK,
      assistantName: runtime.config.assistantName,
      ownerName: runtime.config.ownerName,
      timezone: runtime.config.timezone,
    });
  });

  app.get('/api/transcript', (c) => {
    if (!signedIn(c, runtime)) return c.json({ error: 'Sign in again.' }, 401);
    return c.json(chatState(runtime));
  });

  app.post('/api/device-reply', async (c) => {
    if (!originAllowed(c)) return c.text('Forbidden', 403);
    if (!signedIn(c, runtime)) return c.json({ error: 'Sign in again.' }, 401);
    const body: unknown = await c.req.json().catch(() => null);
    const text = isRecord(body) && typeof body.text === 'string' ? body.text : '';
    if (!text.trim()) return c.json({ error: 'The model reply was empty.' }, 400);
    await handleDeviceReply(runtime, text);
    return c.json({ ...chatState(runtime), needsModel: false });
  });

  app.post('/api/messages', async (c) => {
    if (!originAllowed(c)) {
      runtime.log.warn(
        { origin: c.req.header('origin') ?? '', host: c.req.header('host') ?? '', url: c.req.url },
        'rejected web write',
      );
      return c.text('Forbidden', 403);
    }
    if (!signedIn(c, runtime)) return c.json({ error: 'Sign in again.' }, 401);
    const wantsJson = (c.req.header('content-type') ?? '').includes('application/json');
    let text = '';
    let image: ImagePayload | null = null;
    let engine = engineFor(runtime);
    if (wantsJson) {
      const body: unknown = await c.req.json().catch(() => null);
      if (!isRecord(body)) return c.json({ error: 'Bad request' }, 400);
      text = typeof body.text === 'string' ? body.text.trim() : '';
      const parsed = readImage(body.image);
      if (parsed && 'error' in parsed) return c.json({ error: parsed.error }, 400);
      image = parsed;
      if (body.engine === 'device' || body.engine === 'server') engine = body.engine;
    } else {
      const form = await c.req.parseBody();
      text = typeof form.text === 'string' ? form.text.trim() : '';
    }
    if (!text && !image) return c.json({ error: 'Write a message or attach a photo.' }, 400);
    if (engine === 'server' && !runtime.llm.configured) engine = 'device';

    if (engine === 'device') {
      if (image) {
        const caption = text ? `[Photo] ${text}` : '[Photo]';
        runtime.store.addMessage({ phone: WEB_USER, role: 'user', content: caption, createdAt: runtime.now() });
        await deliverToUser(
          runtime,
          WEB_USER,
          "I saved the photo in the chat, but the on-device model can't see pictures. Set LLM_API_KEY and switch to the hosted model if you want that.",
        );
        const state = { ...chatState(runtime), needsModel: false };
        return wantsJson ? c.json(state) : c.redirect('/#end', 303);
      }
      const result = await handleDeviceText(runtime, text);
      if (!wantsJson && result.needsModel) {
        await deliverToUser(
          runtime,
          WEB_USER,
          'That message is saved. Keep this page open so the on-device model can answer, or use /note and /remind.',
        );
      }
      const state = { ...chatState(runtime), needsModel: result.needsModel, context: result.context ?? null };
      return wantsJson ? c.json(state) : c.redirect('/#end', 303);
    }

    const message: InboundMessage = {
      id: `web-${randomUUID()}`,
      from: WEB_USER,
      source: 'web',
      kind: image ? 'image' : 'text',
      text,
      inlineImage: image ?? undefined,
    };
    await handleInbound(message, runtime);
    const state = chatState(runtime);
    if (wantsJson) return c.json(state);
    return c.redirect('/#end', 303);
  });

  app.get('/api/events', (c) => {
    if (!signedIn(c, runtime)) return c.json({ error: 'Sign in again.' }, 401);
    if (!isWebChannel(runtime.channel)) return c.text('Not found', 404);
    const channel = runtime.channel;
    return streamSSE(c, async (stream) => {
      let unsubscribe = () => {};
      const closed = new Promise<void>((resolve) => {
        c.req.raw.signal.addEventListener('abort', () => resolve(), { once: true });
      });
      unsubscribe = channel.subscribe((event) => {
        stream
          .writeSSE({
            event: event.reminder ? 'reminder' : 'delivery',
            data: JSON.stringify({ text: event.text }),
          })
          .catch(() => {});
      });
      await stream.writeSSE({ event: 'ready', data: '{}' });
      const heartbeat = setInterval(() => {
        stream.writeSSE({ event: 'ping', data: '{}' }).catch(() => {});
      }, 20_000);
      try {
        await closed;
      } finally {
        clearInterval(heartbeat);
        unsubscribe();
      }
    });
  });
}
