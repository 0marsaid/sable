import { redactText } from '../logger.js';
import { maskPhone } from '../phone.js';
import type { Channel, OutboxEntry } from './types.js';

/** Local dry-run channel. Replies stay in memory and are printed, never sent. */
export class ConsoleChannel implements Channel {
  readonly id = 'console' as const;
  readonly outbox: OutboxEntry[] = [];

  constructor(private readonly secrets: string[] = []) {}

  async sendText(to: string, text: string): Promise<void> {
    const entry = { to, text, at: new Date().toISOString() };
    this.outbox.push(entry);
    console.log(
      JSON.stringify({ level: 'info', msg: 'outbound', to: maskPhone(to), text: redactText(text, this.secrets) }),
    );
  }
}
