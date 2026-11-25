import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { llmReady, metaReady, searchReady, twilioReady } from './config.js';
import { errorMessage } from './logger.js';
import { isRecord } from './json.js';
import { handleInbound } from './agent/handle.js';
import type { Runtime } from './runtime.js';
import { runDueReminders } from './scheduler.js';
import { safeEqual, verifyMetaSignature, verifyTwilioSignature } from './security.js';
import { renderStatusPage } from './statusPage.js';
import { parseMetaWebhook } from './whatsapp/meta.js';
import { parseTwilioWebhook, twilioParams } from './whatsapp/twilio.js';
import type { InboundMessage } from './whatsapp/types.js';

export type SableApp = {
  app: Hono;
  drain: () => Promise<void>;
  runScheduler: () => Promise<number>;
};

function publicRequestUrl(requestUrl: string, publicBaseUrl: string): string {
  if (!publicBaseUrl) return '';
  const url = new URL(requestUrl);
  return `${publicBaseUrl}${url.pathname}${url.search}`;
}

export function createApp(runtime: Runtime): SableApp {
  const app = new Hono();
  const inflight = new Set<Promise<void>>();

  function track(work: Promise<void>): void {
    inflight.add(work);
    work.then(
      () => inflight.delete(work),
      (error: unknown) => {
        inflight.delete(work);
        runtime.log.error({ err: errorMessage(error) }, 'inbound handler failed');
      },
    );
  }

  async function drain(): Promise<void> {
    while (inflight.size > 0) {
      await Promise.allSettled([...inflight]);
    }
  }

  app.get('/health', (c) =>
    c.json({
      ok: true,
      assistant: runtime.config.assistantName,
      whatsapp: {
        provider: runtime.config.whatsappProvider,
        configured:
          runtime.config.whatsappProvider === 'console' ||
          (runtime.config.whatsappProvider === 'meta' ? metaReady(runtime.config) : twilioReady(runtime.config)),
      },
      llm: {
        mode: runtime.config.llmMode,
        configured: llmReady(runtime.config) && runtime.llm.configured,
        model: runtime.config.llmModel,
      },
      search: {
        provider: runtime.config.searchProvider,
        configured: searchReady(runtime.config),
      },
      owners: runtime.config.ownerPhones.length,
    }),
  );

  app.get('/', (c) =>
    c.html(renderStatusPage(runtime, { ignored: c.req.query('ignored') === '1' })),
  );

  app.get('/webhook', (c) => {
    const mode = c.req.query('hub.mode') ?? c.req.query('hub_mode') ?? '';
    const token = c.req.query('hub.verify_token') ?? c.req.query('hub_verify_token') ?? '';
    const challenge = c.req.query('hub.challenge') ?? c.req.query('hub_challenge') ?? '';
    const expected = runtime.config.metaVerifyToken;
    if (mode !== 'subscribe' || !expected || !token || !challenge || !safeEqual(token, expected)) {
      return c.text('Forbidden', 403);
    }
    return c.text(challenge);
  });

  app.post('/webhook', async (c) => {
    const raw = await c.req.text();
    const signature = c.req.header('x-hub-signature-256');
    if (!verifyMetaSignature(raw, signature, runtime.config.metaAppSecret)) {
      runtime.log.warn({}, 'rejected WhatsApp webhook with a bad signature');
      return c.text('Forbidden', 403);
    }
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      return c.text('Bad request', 400);
    }
    for (const message of parseMetaWebhook(body)) track(handleInbound(message, runtime));
    return c.json({ ok: true });
  });

  app.post('/webhook/twilio', async (c) => {
    const raw = await c.req.text();
    const params = new URLSearchParams(raw);
    const signedUrl = publicRequestUrl(c.req.url, runtime.config.publicBaseUrl);
    const valid = verifyTwilioSignature(
      runtime.config.twilioAuthToken,
      signedUrl,
      twilioParams(params),
      c.req.header('x-twilio-signature'),
    );
    if (!valid) {
      runtime.log.warn({}, 'rejected Twilio webhook with a bad signature');
      return c.text('Forbidden', 403);
    }
    for (const message of parseTwilioWebhook(params)) track(handleInbound(message, runtime));
    return c.body('<Response></Response>', 200, { 'content-type': 'text/xml; charset=utf-8' });
  });

  if (runtime.config.whatsappProvider === 'console') {
    app.get('/debug/outbox', (c) => c.json({ messages: runtime.channel.outbox ?? [] }));

    app.post('/debug/inbound', async (c) => {
      const contentType = c.req.header('content-type') ?? '';
      const raw = await c.req.text();
      let from = '';
      let text = '';
      let id = '';
      if (contentType.includes('application/json')) {
        let body: unknown;
        try {
          body = JSON.parse(raw);
        } catch {
          return c.text('Bad request', 400);
        }
        if (!isRecord(body)) return c.text('Bad request', 400);
        from = typeof body.from === 'string' ? body.from : '';
        text = typeof body.text === 'string' ? body.text : '';
        id = typeof body.id === 'string' ? body.id : '';
      } else {
        const params = new URLSearchParams(raw);
        from = params.get('from') ?? '';
        text = params.get('text') ?? '';
        id = params.get('id') ?? '';
      }
      if (!from.trim()) return c.text('from is required', 400);
      const before = runtime.channel.outbox?.length ?? 0;
      const message: InboundMessage = {
        id: id.trim() || `console-${randomUUID()}`,
        from,
        source: 'console',
        kind: 'text',
        text,
      };
      await handleInbound(message, runtime);
      const replies = (runtime.channel.outbox ?? []).slice(before).map((entry) => entry.text);
      if (contentType.includes('application/json')) return c.json({ ok: true, replies });
      const ignored = replies.length === 0 ? '?ignored=1' : '';
      return c.redirect(`/${ignored}`, 303);
    });
  }

  return {
    app,
    drain,
    runScheduler: () => runDueReminders(runtime),
  };
}
