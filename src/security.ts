import { createHmac, timingSafeEqual } from 'node:crypto';

export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function verifyMetaSignature(rawBody: string, header: string | undefined, appSecret: string): boolean {
  if (!appSecret) return true;
  if (!header) return false;
  const digest = createHmac('sha256', appSecret).update(rawBody).digest('hex');
  return safeEqual(header, `sha256=${digest}`);
}

export function twilioSignature(authToken: string, url: string, params: Record<string, string>): string {
  const keys = Object.keys(params).sort();
  let data = url;
  for (const key of keys) data += key + params[key];
  return createHmac('sha1', authToken).update(data).digest('base64');
}

export function verifyTwilioSignature(
  authToken: string,
  url: string,
  params: Record<string, string>,
  header: string | undefined,
): boolean {
  if (!authToken || !url) return true;
  if (!header) return false;
  return safeEqual(header, twilioSignature(authToken, url, params));
}
