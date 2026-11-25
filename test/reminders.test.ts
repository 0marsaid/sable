import { describe, expect, it } from 'vitest';
import { createTestApp, FakeChannel } from './helpers.js';

describe('reminder scheduling', () => {
  it('sends a due reminder once and not before it is due', async () => {
    const harness = createTestApp({ now: () => new Date('2026-11-26T16:59:59.000Z') });
    harness.store.addReminder('15551234567', 'Call the dentist', new Date('2026-11-26T17:00:00.000Z'));

    expect(await harness.runScheduler()).toBe(0);
    expect(harness.channel.sent).toHaveLength(0);

    harness.runtime.now = () => new Date('2026-11-26T17:00:00.000Z');
    expect(await harness.runScheduler()).toBe(1);
    expect(harness.channel.sent.map((item) => item.text)).toEqual(['Reminder: Call the dentist']);
    expect(harness.channel.sent[0]?.reminder).toBe(true);

    expect(await harness.runScheduler()).toBe(0);
    expect(harness.channel.sent).toHaveLength(1);
    expect(harness.store.listReminders('15551234567', true)[0]?.status).toBe('sent');
  });

  it('retries a failed send and stops after three failures', async () => {
    const channel = new FakeChannel();
    channel.failTimes = 1;
    const harness = createTestApp({
      channel,
      now: () => new Date('2026-11-26T17:00:00.000Z'),
    });
    const id = harness.store.addReminder('15551234567', 'Stand up', new Date('2026-11-26T17:00:00.000Z'));

    expect(await harness.runScheduler()).toBe(0);
    expect(harness.store.getReminder('15551234567', id)?.status).toBe('pending');

    expect(await harness.runScheduler()).toBe(1);
    expect(harness.store.getReminder('15551234567', id)?.status).toBe('sent');

    const always = new FakeChannel();
    always.failTimes = 10;
    const failing = createTestApp({
      channel: always,
      now: () => new Date('2026-11-26T17:00:00.000Z'),
    });
    const failingId = failing.store.addReminder('15551234567', 'Stand up', new Date('2026-11-26T17:00:00.000Z'));
    await failing.runScheduler();
    await failing.runScheduler();
    await failing.runScheduler();
    await failing.runScheduler();
    expect(always.sent).toHaveLength(0);
    expect(failing.store.getReminder('15551234567', failingId)?.status).toBe('failed');
  });

  it('does not text a number that was removed from the allowlist', async () => {
    const harness = createTestApp({
      env: { OWNER_PHONE_NUMBERS: '+19995550100' },
      now: () => new Date('2026-11-26T17:00:00.000Z'),
    });
    const id = harness.store.addReminder('+15551234567', 'Old reminder', new Date('2026-11-26T17:00:00.000Z'));
    expect(await harness.runScheduler()).toBe(0);
    expect(harness.channel.sent).toHaveLength(0);
    expect(harness.store.getReminder('15551234567', id)?.status).toBe('failed');
  });
});
