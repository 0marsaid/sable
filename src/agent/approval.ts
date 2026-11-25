const YES = new Set([
  'yes',
  'y',
  'yeah',
  'yep',
  'yup',
  'ok',
  'okay',
  'sure',
  'confirm',
  'confirmed',
  'approve',
  'approved',
  'do it',
  'go ahead',
  'go for it',
  'yes please',
  'ok do it',
]);

const NO = new Set([
  'no',
  'n',
  'nope',
  'cancel',
  'stop',
  "don't",
  'dont',
  'nah',
  'never mind',
  'nevermind',
  'no thanks',
  'no thank you',
]);

export function classifyApproval(text: string): 'yes' | 'no' | 'other' {
  const normalized = text.trim().toLowerCase().replace(/[.!,]+$/g, '').replace(/\s+/g, ' ');
  if (YES.has(normalized)) return 'yes';
  if (NO.has(normalized)) return 'no';
  return 'other';
}

export function formatApproval(summaries: string[]): string {
  const intro =
    summaries.length === 1
      ? 'I can do this, but I need your OK first:'
      : 'I can do these, but I need your OK first:';
  const lines = summaries.map((summary) => `• ${summary}`).join('\n');
  return `${intro}\n\n${lines}\n\nReply YES to go ahead, or NO to cancel.`;
}

export const PENDING_TTL_MS = 2 * 60 * 60 * 1000;

export function pendingIsFresh(createdAt: string, now: Date): boolean {
  const created = Date.parse(createdAt);
  if (Number.isNaN(created)) return false;
  return now.getTime() - created < PENDING_TTL_MS;
}
