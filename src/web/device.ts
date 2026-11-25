import { formatInTimeZone } from '../time.js';

export type EngineName = 'device' | 'server';

export type DeviceModel = {
  id: string;
  label: string;
  detail: string;
  /** Approximate download and memory, from WebLLM's vram_required_MB. */
  sizeMb: number;
  tier: 'phone' | 'computer';
  preferred: boolean;
};

/**
 * Quantized builds from WebLLM's prebuilt list.
 * Sizes are the published VRAM estimates, which match the download closely.
 */
export const DEVICE_MODELS: DeviceModel[] = [
  {
    id: 'Qwen2.5-0.5B-Instruct-q4f16_1-MLC',
    label: 'Qwen 2.5 0.5B',
    detail: 'Smallest. Fine for commands and short replies.',
    sizeMb: 945,
    tier: 'phone',
    preferred: false,
  },
  {
    id: 'Llama-3.2-1B-Instruct-q4f16_1-MLC',
    label: 'Llama 3.2 1B',
    detail: 'Best fit for a phone.',
    sizeMb: 879,
    tier: 'phone',
    preferred: true,
  },
  {
    id: 'Llama-3.2-3B-Instruct-q4f16_1-MLC',
    label: 'Llama 3.2 3B',
    detail: 'Best fit for a computer.',
    sizeMb: 2264,
    tier: 'computer',
    preferred: true,
  },
];

export const WEBGPU_FALLBACK =
  'This browser can’t run a model on the device. WebGPU is in Chrome, Edge, and Safari on iOS 26 or newer. You can still use /note and /remind, or switch to a hosted model if the server has LLM_API_KEY set.';

export function defaultEngine(hasServerKey: boolean): EngineName {
  return hasServerKey ? 'server' : 'device';
}

export function chooseEngine(input: {
  defaultEngine: EngineName;
  saved: string | null;
  webgpu: boolean;
  serverAvailable: boolean;
}): { engine: EngineName; reason?: 'no-webgpu' } {
  const saved = input.saved === 'device' || input.saved === 'server' ? input.saved : null;
  let engine: EngineName = saved ?? input.defaultEngine;
  if (engine === 'server' && !input.serverAvailable) engine = 'device';
  if (engine === 'device' && !input.webgpu && input.serverAvailable) {
    return { engine: 'server', reason: 'no-webgpu' };
  }
  if (engine === 'device' && !input.webgpu) return { engine: 'device', reason: 'no-webgpu' };
  return { engine };
}

export function preferredModel(models: DeviceModel[], phone: boolean): string {
  const tier = phone ? 'phone' : 'computer';
  return (models.find((model) => model.tier === tier && model.preferred) ?? models[0]).id;
}

export type ToolCallDraft = { name: string; arguments: Record<string, unknown> };

/** A whole-message JSON tool call. Mixed prose is left as chat so tiny models can fail softly. */
export function parseToolCall(text: string): ToolCallDraft | null {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)```$/i);
  const candidate = (fenced?.[1] ?? trimmed).trim();
  if (!candidate.startsWith('{') || !candidate.endsWith('}')) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const record = parsed as Record<string, unknown>;
  const name = record.tool ?? record.name;
  if (typeof name !== 'string' || !name.trim()) return null;
  const args = record.arguments ?? record.args ?? {};
  if (!args || typeof args !== 'object' || Array.isArray(args)) return null;
  return { name: name.trim(), arguments: args as Record<string, unknown> };
}

type DateParts = { year: number; month: number; day: number };

function dateParts(date: Date, timeZone: string): DateParts {
  const names = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const get = (type: string) => Number(names.find((part) => part.type === type)?.value);
  return { year: get('year'), month: get('month'), day: get('day') };
}

function addDays(parts: DateParts, days: number): DateParts {
  const shifted = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate() };
}

function timezoneOffsetMs(date: Date, timeZone: string): number {
  const names = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(date);
  const get = (type: string) => Number(names.find((part) => part.type === type)?.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return asUtc - date.getTime();
}

function zonedDate(year: number, month: number, day: number, hour: number, minute: number, timeZone: string): Date {
  const guess = new Date(Date.UTC(year, month - 1, day, hour, minute));
  return new Date(guess.getTime() - timezoneOffsetMs(guess, timeZone));
}

export function parseWhen(input: string, now: Date, timeZone: string): Date | null {
  const raw = input.trim();
  const text = raw.toLowerCase().replace(/\s+/g, ' ');
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) {
    const iso = new Date(raw);
    if (!Number.isNaN(iso.getTime())) return iso;
  }
  const relative = text.match(/^in (\d+) (minute|minutes|hour|hours|day|days)$/);
  if (relative) {
    const amount = Number(relative[1]);
    const unit = relative[2];
    const ms = unit.startsWith('minute') ? amount * 60_000 : unit.startsWith('hour') ? amount * 3_600_000 : amount * 86_400_000;
    return new Date(now.getTime() + ms);
  }
  const clock = text.match(/^(today|tomorrow)(?: at)? (\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
  if (!clock) return null;
  let hour = Number(clock[2]);
  const minute = clock[3] ? Number(clock[3]) : 0;
  const suffix = clock[4];
  if (suffix === 'pm' && hour < 12) hour += 12;
  if (suffix === 'am' && hour === 12) hour = 0;
  if (hour > 23 || minute > 59) return null;
  const day = addDays(dateParts(now, timeZone), clock[1] === 'tomorrow' ? 1 : 0);
  return zonedDate(day.year, day.month, day.day, hour, minute, timeZone);
}

export type SlashCommand =
  | { kind: 'help' }
  | { kind: 'note'; text: string; todo: boolean }
  | { kind: 'notes' }
  | { kind: 'remember'; text: string }
  | { kind: 'memory' }
  | { kind: 'reminders' }
  | { kind: 'remind'; when: string; message: string }
  | { kind: 'cancel'; id: number }
  | { kind: 'forget'; id: number }
  | { kind: 'unknown' };

export const HELP_TEXT = [
  'Commands work even before the model finishes downloading.',
  '/note buy milk',
  '/todo call the clinic',
  '/notes',
  '/remember I take my coffee black',
  '/memory',
  '/remind in 2 hours | stretch',
  '/remind tomorrow 9am | call the dentist',
  '/reminders',
  '/cancel 3',
  '/forget 2',
].join('\n');

export function parseSlashCommand(text: string): SlashCommand | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith('/')) return null;
  const [head, ...restParts] = trimmed.split(/\s+/);
  const command = head.slice(1).toLowerCase();
  const rest = restParts.join(' ').trim();
  if (command === 'help') return { kind: 'help' };
  if (command === 'notes') return { kind: 'notes' };
  if (command === 'memory' || command === 'facts') return { kind: 'memory' };
  if (command === 'reminders') return { kind: 'reminders' };
  if (command === 'note' || command === 'todo') {
    return rest ? { kind: 'note', text: rest, todo: command === 'todo' } : { kind: 'unknown' };
  }
  if (command === 'remember') return rest ? { kind: 'remember', text: rest } : { kind: 'unknown' };
  if (command === 'cancel') {
    const id = Number(rest);
    return Number.isInteger(id) && id > 0 ? { kind: 'cancel', id } : { kind: 'unknown' };
  }
  if (command === 'forget') {
    const id = Number(rest);
    return Number.isInteger(id) && id > 0 ? { kind: 'forget', id } : { kind: 'unknown' };
  }
  if (command === 'remind') {
    const split = splitRemind(rest);
    return split ? { kind: 'remind', when: split.when, message: split.message } : { kind: 'unknown' };
  }
  return { kind: 'unknown' };
}

function splitRemind(rest: string): { when: string; message: string } | null {
  if (!rest) return null;
  if (rest.includes('|')) {
    const [when, ...message] = rest.split('|');
    if (when.trim() && message.join('|').trim()) return { when: when.trim(), message: message.join('|').trim() };
    return null;
  }
  const words = rest.split(/\s+/);
  for (let index = 1; index < words.length; index += 1) {
    const when = words.slice(0, index).join(' ');
    const message = words.slice(index).join(' ');
    if (message && /^(in|today|tomorrow|\d{4}-)/i.test(when)) return { when, message };
  }
  return null;
}

export function buildDevicePrompt(input: {
  assistantName: string;
  ownerName: string;
  timezone: string;
  now: Date;
  facts: { id: number; body: string }[];
}): string {
  const facts = input.facts.length
    ? input.facts.map((fact) => `- (#${fact.id}) ${fact.body}`).join('\n')
    : '- (none yet)';
  return [
    `You are ${input.assistantName}, ${input.ownerName}'s personal assistant in a private chat.`,
    'Write like a text message: short, warm, and specific.',
    `Current time: ${formatInTimeZone(input.now, input.timezone)} (${input.now.toISOString()}). Timezone: ${input.timezone}.`,
    `What you remember about ${input.ownerName}:`,
    facts,
    'To use a tool, reply with ONLY this JSON and nothing else:',
    '{"tool":"add_note","arguments":{"text":"buy milk","todo":false}}',
    'Tools: add_note (text, todo), list_notes, remember_fact (fact), list_facts, create_reminder (message, remind_at ISO 8601), list_reminders.',
    'create_reminder, delete_note, forget_fact, and cancel_reminder wait for a yes before they run. Do not say they already happened.',
    'If you are just chatting, reply in plain text. Never invent notes, facts, or reminders.',
    'The user can also type /note, /todo, /remind, /notes, and /help. Those are handled for them.',
  ].join('\n');
}
