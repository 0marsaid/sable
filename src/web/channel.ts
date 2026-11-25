import type { Channel, OutboxEntry } from '../whatsapp/types.js';

export type WebDelivery = { to: string; text: string; at: string; reminder: boolean };
export type WebListener = (event: WebDelivery) => void;

/** Outbound texts for the website. Listeners are the open browser connections. */
export class WebChannel implements Channel {
  readonly id = 'web' as const;
  readonly outbox: OutboxEntry[] = [];
  private readonly listeners = new Set<WebListener>();

  subscribe(listener: WebListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async sendText(to: string, text: string, options?: { reminder?: boolean }): Promise<void> {
    const event: WebDelivery = {
      to,
      text,
      at: new Date().toISOString(),
      reminder: Boolean(options?.reminder),
    };
    this.outbox.push({ to, text, at: event.at });
    for (const listener of this.listeners) listener(event);
  }
}

export function isWebChannel(channel: Channel): channel is WebChannel {
  return channel.id === 'web';
}
