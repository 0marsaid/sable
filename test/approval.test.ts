import { describe, expect, it } from 'vitest';
import type { ChatResult } from '../src/llm/types.js';
import { createTestApp, metaEnvelope, postWebhook, ScriptedLlm, textMessage } from './helpers.js';

const FUTURE = '2026-11-26T17:00:00.000Z';
const NOW = new Date('2026-11-25T17:00:00.000Z');

function reminderCall(remindAt = FUTURE): ChatResult {
  return {
    content: 'Sure, I will set that now.',
    toolCalls: [
      {
        id: 'call_reminder',
        name: 'create_reminder',
        arguments: { message: 'Call the dentist', remind_at: remindAt },
      },
    ],
  };
}

async function ask(harness: ReturnType<typeof createTestApp>, id: string, text: string): Promise<void> {
  await postWebhook(harness.app, metaEnvelope(textMessage({ id, text })));
  await harness.drain();
}

describe('approval', () => {
  it('asks before a sensitive tool and runs it only after YES', async () => {
    const llm = new ScriptedLlm([reminderCall(), { content: 'Reminder set for tomorrow.', toolCalls: [] }]);
    const harness = createTestApp({ llm, now: () => NOW });

    await ask(harness, 'wamid.ask', 'Remind me to call the dentist tomorrow at 9');
    expect(harness.channel.sent).toHaveLength(1);
    expect(harness.channel.sent[0]?.text).toContain('Call the dentist');
    expect(harness.channel.sent[0]?.text).toContain('YES');
    expect(harness.channel.sent[0]?.text).not.toContain('Sure, I will set that now.');
    expect(harness.store.listReminders('15551234567')).toHaveLength(0);

    await ask(harness, 'wamid.yes', 'YES');
    expect(harness.store.listReminders('15551234567')).toHaveLength(1);
    expect(harness.store.listReminders('15551234567')[0]?.message).toBe('Call the dentist');
    expect(harness.channel.sent.at(-1)?.text).toBe('Reminder set for tomorrow.');
  });

  it('does not run the tool when the owner says no', async () => {
    const llm = new ScriptedLlm([reminderCall()]);
    const harness = createTestApp({ llm, now: () => NOW });
    await ask(harness, 'wamid.ask', 'Remind me to call the dentist tomorrow at 9');
    await ask(harness, 'wamid.no', 'No');

    expect(harness.store.listReminders('15551234567', true)).toHaveLength(0);
    expect(harness.channel.sent.at(-1)?.text).toBe("Okay, I won't do that.");
    expect(llm.requests).toHaveLength(1);
  });

  it('drops the pending action when the next text is not yes or no', async () => {
    const llm = new ScriptedLlm([reminderCall(), { content: 'Four.', toolCalls: [] }]);
    const harness = createTestApp({ llm, now: () => NOW });
    await ask(harness, 'wamid.ask', 'Remind me to call the dentist tomorrow at 9');
    await ask(harness, 'wamid.next', 'What is 2 + 2?');

    expect(harness.store.listReminders('15551234567', true)).toHaveLength(0);
    expect(harness.store.getPending('15551234567')).toBeUndefined();
    expect(harness.channel.sent.at(-1)?.text).toContain('I dropped the action');
    expect(harness.channel.sent.at(-1)?.text).toContain('Four.');
  });

  it('does not ask for approval when the reminder time is invalid', async () => {
    const llm = new ScriptedLlm([
      reminderCall('2020-01-01T00:00:00.000Z'),
      { content: 'That time has already passed. When should I remind you?', toolCalls: [] },
    ]);
    const harness = createTestApp({ llm, now: () => NOW });
    await ask(harness, 'wamid.past', 'Remind me yesterday');

    expect(harness.channel.sent).toHaveLength(1);
    expect(harness.channel.sent[0]?.text).toBe('That time has already passed. When should I remind you?');
    expect(harness.channel.sent[0]?.text).not.toContain('YES');
    expect(harness.store.listReminders('15551234567', true)).toHaveLength(0);
  });

  it('expires a confirmation that sits too long', async () => {
    let now = NOW;
    const llm = new ScriptedLlm([reminderCall()]);
    const harness = createTestApp({ llm, now: () => now });
    await ask(harness, 'wamid.ask', 'Remind me to call the dentist tomorrow at 9');
    now = new Date(NOW.getTime() + 3 * 60 * 60 * 1000);
    await ask(harness, 'wamid.late', 'yes');

    expect(harness.channel.sent.at(-1)?.text).toContain('expired');
    expect(harness.store.listReminders('15551234567', true)).toHaveLength(0);
    expect(llm.requests).toHaveLength(1);
  });
});
