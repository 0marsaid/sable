import type { AppConfig } from '../config.js';
import { downloadMetaMedia } from './meta.js';
import { downloadTwilioMedia } from './twilio.js';
import type { DownloadedMedia, InboundMessage } from './types.js';

export async function downloadInboundMedia(
  message: InboundMessage,
  config: AppConfig,
  fetchImpl: typeof fetch,
): Promise<DownloadedMedia | null> {
  if (message.source === 'meta' && message.mediaId) {
    return downloadMetaMedia(message.mediaId, config, fetchImpl);
  }
  if (message.source === 'twilio' && message.mediaUrl) {
    return downloadTwilioMedia(message.mediaUrl, message.mimeType || 'image/jpeg', config, fetchImpl);
  }
  return null;
}
