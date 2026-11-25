import { formatInTimeZone, parseIsoDate } from '../time.js';
import { requiredId, requiredText, type Tool } from './types.js';

export function reminderTools(): Tool[] {
  const create: Tool = {
    name: 'create_reminder',
    sensitive: true,
    description:
      'Schedule a WhatsApp message back to the user at a specific time. Pass remind_at as ISO 8601 with a timezone offset. The app asks the user to confirm before it is saved.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        message: { type: 'string', description: 'What to text them when it is time' },
        remind_at: { type: 'string', description: 'ISO 8601 datetime, for example 2026-11-26T09:00:00-08:00' },
      },
      required: ['message', 'remind_at'],
    },
    summarize: (args, ctx) => {
      const when = parseIsoDate(args.remind_at);
      const whenText = when ? formatInTimeZone(when, ctx.timezone) : String(args.remind_at ?? '');
      return `Text you at ${whenText}: ${String(args.message ?? '')}`;
    },
    validate: (args, ctx) => {
      const missing = requiredText(args, 'message', 'message');
      if (missing) return missing;
      if (String(args.message).trim().length > 1000) return 'Keep the reminder under 1000 characters.';
      const when = parseIsoDate(args.remind_at);
      if (!when) return 'remind_at must be an ISO 8601 datetime, like 2026-11-26T09:00:00-08:00.';
      if (when.getTime() <= ctx.now.getTime() + 5_000) {
        return 'That time is not in the future. Ask for a later time and convert it to ISO 8601.';
      }
      return null;
    },
    async execute(args, ctx) {
      const when = parseIsoDate(args.remind_at)!;
      const message = String(args.message).trim();
      const id = ctx.store.addReminder(ctx.phone, message, when);
      return `Reminder #${id} set for ${formatInTimeZone(when, ctx.timezone)}: ${message}`;
    },
  };

  const list: Tool = {
    name: 'list_reminders',
    sensitive: false,
    description: 'List upcoming reminders that have not been sent or cancelled.',
    parameters: { type: 'object', additionalProperties: false, properties: {} },
    summarize: () => 'List upcoming reminders.',
    async execute(_args, ctx) {
      const reminders = ctx.store.listReminders(ctx.phone);
      if (reminders.length === 0) return 'No upcoming reminders.';
      return reminders
        .map((reminder) => {
          const when = formatInTimeZone(new Date(reminder.dueAt), ctx.timezone);
          return `#${reminder.id} at ${when}: ${reminder.message}`;
        })
        .join('\n');
    },
  };

  const cancel: Tool = {
    name: 'cancel_reminder',
    sensitive: true,
    description: 'Cancel an upcoming reminder by id so it will not be sent.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: { id: { type: 'integer' } },
      required: ['id'],
    },
    summarize: (args, ctx) => {
      const id = requiredId(args);
      const reminder = id ? ctx.store.getReminder(ctx.phone, id) : undefined;
      return reminder
        ? `Cancel reminder #${reminder.id}: ${reminder.message}`
        : `Cancel reminder #${String(args.id ?? '')}`;
    },
    validate: (args, ctx) => {
      const id = requiredId(args);
      if (!id) return 'id must be a positive integer.';
      const reminder = ctx.store.getReminder(ctx.phone, id);
      if (!reminder) return `No reminder with id ${id}.`;
      if (reminder.status !== 'pending' && reminder.status !== 'sending') {
        return `Reminder #${id} is already ${reminder.status}.`;
      }
      return null;
    },
    async execute(args, ctx) {
      const id = requiredId(args)!;
      const reminder = ctx.store.getReminder(ctx.phone, id);
      const ok = ctx.store.cancelReminder(ctx.phone, id);
      if (!ok || !reminder) return `Couldn't cancel reminder #${id}.`;
      return `Cancelled reminder #${id}: ${reminder.message}`;
    },
  };

  return [create, list, cancel];
}
