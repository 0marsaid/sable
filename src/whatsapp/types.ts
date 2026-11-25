export type InboundKind = 'text' | 'image' | 'unsupported' | 'ignore';

export type InboundMessage = {
  id: string;
  from: string;
  source: 'meta' | 'twilio' | 'console';
  kind: InboundKind;
  text?: string;
  unsupportedLabel?: string;
  mediaId?: string;
  mediaUrl?: string;
  mimeType?: string;
};

export type OutboxEntry = { to: string; text: string; at: string };

export type Channel = {
  id: 'meta' | 'twilio' | 'console';
  sendText(to: string, text: string, options?: { reminder?: boolean }): Promise<void>;
  outbox?: OutboxEntry[];
};

export type DownloadedMedia = { mimeType: string; base64: string };
