import type { AppConfig } from '../config.js';
import { isRecord } from '../json.js';
import { normalizePhone } from '../phone.js';
import type { Channel, DownloadedMedia, InboundMessage } from './types.js';

const IMAGE_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

function stringField(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === 'string' ? value : '';
}

function parseOne(message: Record<string, unknown>): InboundMessage | null {
  const id = stringField(message, 'id');
  const from = stringField(message, 'from');
  if (!id || !from) return null;
  if (typeof message.group_id === 'string') return null;

  const base = { id, from, source: 'meta' as const };
  const type = stringField(message, 'type') || 'unknown';

  if (type === 'text' && isRecord(message.text)) {
    return { ...base, kind: 'text', text: stringField(message.text, 'body') };
  }
  if (type === 'image' && isRecord(message.image)) {
    return {
      ...base,
      kind: 'image',
      text: stringField(message.image, 'caption'),
      mediaId: stringField(message.image, 'id'),
      mimeType: stringField(message.image, 'mime_type') || 'image/jpeg',
    };
  }
  if (type === 'button' && isRecord(message.button)) {
    return { ...base, kind: 'text', text: stringField(message.button, 'text') };
  }
  if (type === 'interactive' && isRecord(message.interactive)) {
    const reply = isRecord(message.interactive.button_reply)
      ? message.interactive.button_reply
      : isRecord(message.interactive.list_reply)
        ? message.interactive.list_reply
        : null;
    const text = reply ? stringField(reply, 'title') : '';
    return text ? { ...base, kind: 'text', text } : { ...base, kind: 'ignore' };
  }
  if (type === 'location' && isRecord(message.location)) {
    const lat = message.location.latitude;
    const lng = message.location.longitude;
    const name = stringField(message.location, 'name');
    const label = name ? `${name} (${lat}, ${lng})` : `${lat}, ${lng}`;
    return { ...base, kind: 'text', text: `Location: ${label}` };
  }
  if (type === 'reaction' || type === 'system') return { ...base, kind: 'ignore' };

  const labels: Record<string, string> = {
    audio: 'voice notes',
    video: 'videos',
    document: 'documents',
    sticker: 'stickers',
    contacts: 'contact cards',
  };
  return { ...base, kind: 'unsupported', unsupportedLabel: labels[type] || 'that attachment' };
}

export function parseMetaWebhook(body: unknown): InboundMessage[] {
  if (!isRecord(body) || !Array.isArray(body.entry)) return [];
  const messages: InboundMessage[] = [];
  for (const entry of body.entry) {
    if (!isRecord(entry) || !Array.isArray(entry.changes)) continue;
    for (const change of entry.changes) {
      if (!isRecord(change) || !isRecord(change.value) || !Array.isArray(change.value.messages)) continue;
      for (const message of change.value.messages) {
        if (!isRecord(message)) continue;
        const parsed = parseOne(message);
        if (parsed) messages.push(parsed);
      }
    }
  }
  return messages;
}

async function readBytes(response: Response, limit: number): Promise<Buffer | null> {
  const reader = response.body?.getReader();
  if (!reader) return Buffer.from(await response.arrayBuffer());
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

export async function downloadMetaMedia(
  mediaId: string,
  config: AppConfig,
  fetchImpl: typeof fetch,
): Promise<DownloadedMedia | null> {
  if (!config.metaAccessToken || !mediaId) return null;
  const meta = await fetchImpl(`https://graph.facebook.com/${config.metaApiVersion}/${mediaId}`, {
    headers: { authorization: `Bearer ${config.metaAccessToken}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (!meta.ok) return null;
  const info: unknown = await meta.json();
  if (!isRecord(info) || typeof info.url !== 'string') return null;
  const mimeType = typeof info.mime_type === 'string' ? info.mime_type : 'image/jpeg';
  if (!IMAGE_MIME.has(mimeType.split(';')[0].trim().toLowerCase())) return null;
  const file = await fetchImpl(info.url, {
    headers: { authorization: `Bearer ${config.metaAccessToken}` },
    signal: AbortSignal.timeout(20_000),
  });
  if (!file.ok) return null;
  const bytes = await readBytes(file, 4_000_000);
  if (!bytes || bytes.length === 0) return null;
  return { mimeType, base64: bytes.toString('base64') };
}

export function createMetaChannel(config: AppConfig, fetchImpl: typeof fetch): Channel {
  return {
    id: 'meta',
    async sendText(to, text, options) {
      if (!config.metaAccessToken || !config.metaPhoneNumberId) {
        throw new Error('Meta WhatsApp is not configured. Set META_ACCESS_TOKEN and META_PHONE_NUMBER_ID.');
      }
      const recipient = normalizePhone(to);
      const useTemplate = Boolean(options?.reminder && config.metaReminderTemplate);
      const payload = useTemplate
        ? {
            messaging_product: 'whatsapp',
            to: recipient,
            type: 'template',
            template: {
              name: config.metaReminderTemplate,
              language: { code: config.metaReminderTemplateLang },
              components: [
                {
                  type: 'body',
                  parameters: [{ type: 'text', text }],
                },
              ],
            },
          }
        : {
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to: recipient,
            type: 'text',
            text: { preview_url: false, body: text },
          };

      const response = await fetchImpl(
        `https://graph.facebook.com/${config.metaApiVersion}/${config.metaPhoneNumberId}/messages`,
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${config.metaAccessToken}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(20_000),
        },
      );
      if (!response.ok) {
        const detail = (await response.text())
          .replaceAll(config.metaAccessToken, '[redacted]')
          .replace(/\s+/g, ' ')
          .slice(0, 300);
        throw new Error(`WhatsApp send failed (${response.status}): ${detail}`);
      }
    },
  };
}
