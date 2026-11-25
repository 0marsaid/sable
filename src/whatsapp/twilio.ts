import type { AppConfig } from '../config.js';
import { normalizePhone } from '../phone.js';
import type { Channel, DownloadedMedia, InboundMessage } from './types.js';

function formValue(params: URLSearchParams, key: string): string {
  return (params.get(key) ?? '').trim();
}

export function parseTwilioWebhook(params: URLSearchParams): InboundMessage[] {
  const id = formValue(params, 'MessageSid') || formValue(params, 'SmsMessageSid');
  const from = formValue(params, 'From');
  if (!id || !from) return [];

  const body = formValue(params, 'Body');
  const numMedia = Number(formValue(params, 'NumMedia') || '0');
  const base = { id, from, source: 'twilio' as const };

  if (numMedia > 0) {
    const mime = formValue(params, 'MediaContentType0').toLowerCase();
    const url = formValue(params, 'MediaUrl0');
    if (mime.startsWith('image/') && url) {
      return [{ ...base, kind: 'image', text: body, mediaUrl: url, mimeType: mime }];
    }
    const label = mime.startsWith('audio/')
      ? 'voice notes'
      : mime.startsWith('video/')
        ? 'videos'
        : 'that attachment';
    return [{ ...base, kind: 'unsupported', unsupportedLabel: label, text: body }];
  }

  return [{ ...base, kind: 'text', text: body }];
}

export function twilioParams(params: URLSearchParams): Record<string, string> {
  const record: Record<string, string> = {};
  for (const [key, value] of params.entries()) record[key] = value;
  return record;
}

export async function downloadTwilioMedia(
  mediaUrl: string,
  mimeType: string,
  config: AppConfig,
  fetchImpl: typeof fetch,
): Promise<DownloadedMedia | null> {
  if (!config.twilioAccountSid || !config.twilioAuthToken || !mediaUrl) return null;
  if (!mimeType.toLowerCase().startsWith('image/')) return null;
  const token = Buffer.from(`${config.twilioAccountSid}:${config.twilioAuthToken}`).toString('base64');
  const response = await fetchImpl(mediaUrl, {
    headers: { authorization: `Basic ${token}` },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) return null;
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length === 0 || bytes.length > 4_000_000) return null;
  return { mimeType, base64: bytes.toString('base64') };
}

function whatsappAddress(value: string): string {
  if (value.toLowerCase().startsWith('whatsapp:')) return value;
  return `whatsapp:+${normalizePhone(value)}`;
}

export function createTwilioChannel(config: AppConfig, fetchImpl: typeof fetch): Channel {
  return {
    id: 'twilio',
    async sendText(to, text) {
      if (!config.twilioAccountSid || !config.twilioAuthToken) {
        throw new Error('Twilio is not configured. Set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN.');
      }
      const body = new URLSearchParams({
        To: whatsappAddress(to),
        From: whatsappAddress(config.twilioWhatsappFrom),
        Body: text,
      });
      const token = Buffer.from(`${config.twilioAccountSid}:${config.twilioAuthToken}`).toString('base64');
      const response = await fetchImpl(
        `https://api.twilio.com/2010-04-01/Accounts/${config.twilioAccountSid}/Messages.json`,
        {
          method: 'POST',
          headers: {
            authorization: `Basic ${token}`,
            'content-type': 'application/x-www-form-urlencoded',
          },
          body,
          signal: AbortSignal.timeout(20_000),
        },
      );
      if (!response.ok) {
        const detail = (await response.text())
          .replaceAll(config.twilioAuthToken, '[redacted]')
          .replace(/\s+/g, ' ')
          .slice(0, 300);
        throw new Error(`Twilio send failed (${response.status}): ${detail}`);
      }
    },
  };
}
