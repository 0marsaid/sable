import { secretValues, type AppConfig } from '../config.js';
import { WebChannel } from '../web/channel.js';
import { ConsoleChannel } from './console.js';
import { createMetaChannel } from './meta.js';
import { createTwilioChannel } from './twilio.js';
import type { Channel } from './types.js';

export function createChannel(config: AppConfig, fetchImpl: typeof fetch = fetch): Channel {
  if (config.channel === 'web') return new WebChannel();
  if (config.whatsappProvider === 'meta') return createMetaChannel(config, fetchImpl);
  if (config.whatsappProvider === 'twilio') return createTwilioChannel(config, fetchImpl);
  return new ConsoleChannel(secretValues(config));
}
