/** Digits only, no plus. `whatsapp:+1 (555) 123-4567` and `15551234567` match. */
export function normalizePhone(input: string): string {
  let value = input.trim().toLowerCase();
  if (value.startsWith('whatsapp:')) value = value.slice('whatsapp:'.length);
  return value.replace(/\D/g, '');
}

export function formatPhone(digits: string): string {
  return digits ? `+${digits}` : '';
}

export function maskPhone(input: string): string {
  const digits = normalizePhone(input);
  if (!digits) return 'unknown';
  if (digits.length <= 4) return '****';
  return `***${digits.slice(-4)}`;
}

export function isAllowed(phone: string, allowlist: readonly string[]): boolean {
  if (allowlist.length === 0) return false;
  const normalized = normalizePhone(phone);
  if (!normalized) return false;
  return allowlist.includes(normalized);
}

export function parseAllowlist(raw: string): string[] {
  const seen = new Set<string>();
  for (const part of raw.split(',')) {
    const normalized = normalizePhone(part);
    if (normalized) seen.add(normalized);
  }
  return [...seen];
}
