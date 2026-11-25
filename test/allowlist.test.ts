import { describe, expect, it } from 'vitest';
import { createTestApp, metaEnvelope, postWebhook, textMessage } from './helpers.js';

describe('owner allowlist', () => {
  it('replies to the owner when the number is written with spaces and punctuation', async () => {
    const harness = createTestApp();
    const response = await postWebhook(
      harness.app,
      metaEnvelope(textMessage({ from: '15551234567', text: 'Hi' })),
    );
    expect(response.status).toBe(200);
    await harness.drain();
    expect(harness.channel.sent).toHaveLength(1);
    expect(harness.channel.sent[0]?.to).toBe('15551234567');
  });

  it('accepts the webhook but does not reply to anyone else', async () => {
    const harness = createTestApp();
    const response = await postWebhook(
      harness.app,
      metaEnvelope(textMessage({ from: '19995550123', id: 'wamid.stranger', text: 'Hi' })),
    );
    expect(response.status).toBe(200);
    await harness.drain();
    expect(harness.channel.sent).toHaveLength(0);
    expect(harness.store.recentMessages('19995550123', 10)).toHaveLength(0);
  });

  it('ignores everyone when the allowlist is empty', async () => {
    const harness = createTestApp({ env: { OWNER_PHONE_NUMBERS: '' } });
    const response = await postWebhook(harness.app, metaEnvelope(textMessage({ text: 'Hi' })));
    expect(response.status).toBe(200);
    await harness.drain();
    expect(harness.channel.sent).toHaveLength(0);
  });
});
