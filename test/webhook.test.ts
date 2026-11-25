import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { twilioSignature } from '../src/security.js';
import { createTestApp, metaEnvelope, postWebhook, textMessage } from './helpers.js';

describe('webhook verification', () => {
  it('returns the challenge when the verify token matches', async () => {
    const { app } = createTestApp();
    const response = await app.request(
      '/webhook?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=1158201444',
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('1158201444');
  });

  it('rejects a wrong verify token, a missing challenge, and an empty configured token', async () => {
    const { app } = createTestApp();
    const wrong = await app.request('/webhook?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=1');
    expect(wrong.status).toBe(403);

    const missing = await app.request('/webhook?hub.mode=subscribe&hub.verify_token=verify-me');
    expect(missing.status).toBe(403);

    const open = createTestApp({ env: { META_VERIFY_TOKEN: '' } });
    const blank = await open.app.request('/webhook?hub.mode=subscribe&hub.verify_token=&hub.challenge=1');
    expect(blank.status).toBe(403);
  });
});

describe('inbound webhooks', () => {
  it('accepts a Meta message and ignores status-only payloads', async () => {
    const harness = createTestApp();
    const response = await postWebhook(harness.app, metaEnvelope(textMessage({ text: 'Hello' })));
    expect(response.status).toBe(200);
    await harness.drain();
    expect(harness.channel.sent.map((item) => item.text)).toEqual(['Hello Omar']);

    const statuses = await postWebhook(harness.app, {
      object: 'whatsapp_business_account',
      entry: [{ changes: [{ value: { statuses: [{ id: 'wamid.1', status: 'delivered' }] } }] }],
    });
    expect(statuses.status).toBe(200);
    await harness.drain();
    expect(harness.channel.sent).toHaveLength(1);
  });

  it('checks the Meta signature when an app secret is set', async () => {
    const secret = 'app-secret-value';
    const harness = createTestApp({ env: { META_APP_SECRET: secret } });
    const raw = JSON.stringify(metaEnvelope(textMessage({ text: 'Hello', id: 'wamid.signed' })));
    const bad = await postWebhook(harness.app, raw, { 'x-hub-signature-256': 'sha256=deadbeef' });
    expect(bad.status).toBe(403);

    const signature = `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`;
    const good = await postWebhook(harness.app, raw, { 'x-hub-signature-256': signature });
    expect(good.status).toBe(200);
    await harness.drain();
    expect(harness.channel.sent).toHaveLength(1);
  });

  it('does not answer the same message twice', async () => {
    const harness = createTestApp();
    const body = metaEnvelope(textMessage({ text: 'Hello', id: 'wamid.same' }));
    await postWebhook(harness.app, body);
    await postWebhook(harness.app, body);
    await harness.drain();
    expect(harness.channel.sent).toHaveLength(1);
  });

  it('accepts a signed Twilio sandbox message and rejects a bad signature', async () => {
    const harness = createTestApp({
      env: {
        WHATSAPP_PROVIDER: 'twilio',
        TWILIO_ACCOUNT_SID: 'ACxxx',
        TWILIO_AUTH_TOKEN: 'twilio-auth-token',
        PUBLIC_BASE_URL: 'https://sable.example.com',
      },
    });
    const params = new URLSearchParams({
      MessageSid: 'SM123',
      From: 'whatsapp:+15551234567',
      To: 'whatsapp:+14155238886',
      Body: 'Hello from the sandbox',
      NumMedia: '0',
    });
    const url = 'https://sable.example.com/webhook/twilio';
    const record = Object.fromEntries(params.entries());
    const good = await harness.app.request('/webhook/twilio', {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'x-twilio-signature': twilioSignature('twilio-auth-token', url, record),
      },
      body: params.toString(),
    });
    expect(good.status).toBe(200);
    await harness.drain();
    expect(harness.channel.sent[0]?.text).toBe('Hello Omar');

    const bad = await harness.app.request('/webhook/twilio', {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'x-twilio-signature': 'not-a-signature',
      },
      body: params.toString(),
    });
    expect(bad.status).toBe(403);
  });

  it('hides the debug inbox unless the provider is the local console', async () => {
    const harness = createTestApp({ env: { WHATSAPP_PROVIDER: 'meta' } });
    const response = await harness.app.request('/debug/outbox');
    expect(response.status).toBe(404);
  });
});
