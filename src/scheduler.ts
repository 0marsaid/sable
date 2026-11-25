import { errorMessage } from './logger.js';
import { isAllowed, isWebUser, maskPhone } from './phone.js';
import type { Runtime } from './runtime.js';
import { deliverReminder } from './agent/handle.js';

export async function runDueReminders(runtime: Runtime, now = runtime.now()): Promise<number> {
  const due = runtime.store.dueReminders(now.toISOString());
  let sent = 0;
  for (const reminder of due) {
    if (!runtime.store.claimReminder(reminder.id, now.toISOString())) continue;
    const webReminder = isWebUser(reminder.phone);
    if (webReminder && runtime.config.channel !== 'web') {
      runtime.store.failReminder(reminder.id, 'web chat is off');
      continue;
    }
    if (!webReminder && !isAllowed(reminder.phone, runtime.config.ownerPhones)) {
      runtime.store.failReminder(reminder.id, 'number is no longer allowlisted');
      continue;
    }
    try {
      // A Meta template is expected to read "Reminder: {{1}}", so the variable is
      // the note itself. Free-form texts include the prefix in the body.
      const useTemplate = runtime.channel.id === 'meta' && Boolean(runtime.config.metaReminderTemplate);
      const text = useTemplate ? reminder.message : `Reminder: ${reminder.message}`;
      await deliverReminder(runtime, reminder.phone, text);
      runtime.store.markReminderSent(reminder.id, now.toISOString());
      sent += 1;
    } catch (error) {
      const status = runtime.store.markReminderRetry(reminder.id, errorMessage(error));
      runtime.log.error(
        {
          reminder: reminder.id,
          to: webReminder ? 'web' : maskPhone(reminder.phone),
          status,
          err: errorMessage(error),
        },
        'reminder send failed',
      );
    }
  }
  const cutoff = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString();
  runtime.store.pruneProcessed(cutoff);
  return sent;
}
