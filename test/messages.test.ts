import { describe, expect, it } from 'vitest';
import type { ChatResult } from '../src/llm/types.js';
import { createTestApp, metaEnvelope, postWebhook, ScriptedLlm, textMessage } from './helpers.js';

const noted: ChatResult[] = [
  {
    content: null,
    toolCalls: [{ id: 'call_note', name: 'add_note', arguments: { text: 'Buy oat milk', todo: true } }],
  },
  { content: 'Added oat milk to your list.', toolCalls: [] },
];

describe('message handling', () => {
  it('turns a verified webhook and a mocked inbound text into a reply', async () => {
    const harness = createTestApp({ llm: new ScriptedLlm([{ content: 'Hello Omar', toolCalls: [] }]) });

    const verify = await harness.app.request(
      '/webhook?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=ok-token',
    );
    expect(await verify.text()).toBe('ok-token');

    const inbound = await postWebhook(harness.app, metaEnvelope(textMessage({ text: 'Good morning' })));
    expect(inbound.status).toBe(200);
    await harness.drain();

    expect(harness.channel.sent.map((item) => item.text)).toEqual(['Hello Omar']);
    const history = harness.store.recentMessages('15551234567', 10);
    expect(history.map((row) => row.role)).toEqual(['user', 'assistant']);
    expect(history[0]?.content).toBe('Good morning');
  });

  it('runs a safe tool, keeps the note, and answers with the model’s follow-up', async () => {
    const llm = new ScriptedLlm(noted);
    const harness = createTestApp({ llm });
    await postWebhook(harness.app, metaEnvelope(textMessage({ text: 'Add oat milk to my list' })));
    await harness.drain();

    expect(harness.channel.sent.map((item) => item.text)).toEqual(['Added oat milk to your list.']);
    expect(harness.store.listNotes('15551234567').map((note) => note.body)).toEqual(['Buy oat milk']);
    expect(llm.requests).toHaveLength(2);
  });

  it('puts a saved fact into the next turn’s system prompt', async () => {
    const llm = new ScriptedLlm([
      {
        content: null,
        toolCalls: [{ id: 'call_fact', name: 'remember_fact', arguments: { fact: 'Omar prefers aisle seats' } }],
      },
      { content: 'I’ll remember that.', toolCalls: [] },
      { content: 'You prefer aisle seats.', toolCalls: [] },
    ]);
    const harness = createTestApp({ llm });
    await postWebhook(harness.app, metaEnvelope(textMessage({ id: 'wamid.a', text: 'Remember I prefer aisle seats' })));
    await harness.drain();
    await postWebhook(harness.app, metaEnvelope(textMessage({ id: 'wamid.b', text: 'What seat do I like?' })));
    await harness.drain();

    const system = llm.requests[2]?.messages.find((message) => message.role === 'system');
    expect(system && system.role === 'system' ? system.content : '').toContain('Omar prefers aisle seats');
    expect(harness.channel.sent.at(-1)?.text).toBe('You prefer aisle seats.');
  });

  it('refuses stickers without calling the model and passes photos through', async () => {
    const llm = new ScriptedLlm([{ content: 'That looks like a boarding pass.', toolCalls: [] }]);
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      if (url.endsWith('/MEDIA123')) {
        return new Response(JSON.stringify({ url: 'https://cdn.example/img.jpg', mime_type: 'image/jpeg' }), {
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url === 'https://cdn.example/img.jpg') return new Response(png);
      return new Response('missing', { status: 404 });
    };
    const harness = createTestApp({
      llm,
      fetchImpl,
      env: { META_ACCESS_TOKEN: 'meta-access-token', META_PHONE_NUMBER_ID: '123', WHATSAPP_PROVIDER: 'meta' },
    });

    await postWebhook(
      harness.app,
      metaEnvelope({
        from: '15551234567',
        id: 'wamid.sticker',
        timestamp: '1710000000',
        type: 'sticker',
        sticker: { id: 'STICK', mime_type: 'image/webp' },
      }),
    );
    await harness.drain();
    expect(harness.channel.sent[0]?.text).toContain("can't open stickers");
    expect(llm.requests).toHaveLength(0);

    await postWebhook(
      harness.app,
      metaEnvelope({
        from: '15551234567',
        id: 'wamid.photo',
        timestamp: '1710000000',
        type: 'image',
        image: { id: 'MEDIA123', mime_type: 'image/jpeg', caption: 'What is this?' },
      }),
    );
    await harness.drain();
    expect(harness.channel.sent.at(-1)?.text).toBe('That looks like a boarding pass.');
    const lastUser = llm.requests[0]?.messages.filter((message) => message.role === 'user').at(-1);
    expect(lastUser && lastUser.role === 'user' && Array.isArray(lastUser.content)).toBe(true);
    if (lastUser && lastUser.role === 'user' && Array.isArray(lastUser.content)) {
      expect(lastUser.content.some((part) => part.type === 'image_url' && part.imageUrl.startsWith('data:image/jpeg'))).toBe(
        true,
      );
    }
  });

  it('ignores reactions and answers a shared location as text', async () => {
    const llm = new ScriptedLlm([{ content: 'On my way.', toolCalls: [] }]);
    const harness = createTestApp({ llm });
    await postWebhook(
      harness.app,
      metaEnvelope({
        from: '15551234567',
        id: 'wamid.react',
        timestamp: '1710000000',
        type: 'reaction',
        reaction: { message_id: 'wamid.old', emoji: '👍' },
      }),
    );
    await harness.drain();
    expect(harness.channel.sent).toHaveLength(0);

    await postWebhook(
      harness.app,
      metaEnvelope({
        from: '15551234567',
        id: 'wamid.loc',
        timestamp: '1710000000',
        type: 'location',
        location: { latitude: 37.8, longitude: -122.4, name: 'Ferry Building' },
      }),
    );
    await harness.drain();
    const user = llm.requests[0]?.messages.find((message) => message.role === 'user');
    expect(user && user.role === 'user' ? user.content : '').toContain('Ferry Building');
    expect(harness.channel.sent[0]?.text).toBe('On my way.');
  });

  it('answers a console dry-run message with the mock reply', async () => {
    const harness = createTestApp();
    const response = await harness.app.request('/debug/inbound', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ from: '+1 (555) 123-4567', text: 'Hello' }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { replies: string[] };
    expect(body.replies).toEqual(['Hello Omar']);
  });

  it('returns the browser to the conversation after a form submit', async () => {
    const harness = createTestApp();
    const response = await harness.app.request('/debug/inbound', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'from=%2B15551234567&text=Hello',
    });
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/#chat');
    const page = await harness.app.request('/');
    expect(await page.text()).toContain('id="chat"');
  });
});
