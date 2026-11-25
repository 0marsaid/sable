import type { AppConfig } from './config.js';
import type { Logger } from './logger.js';
import type { LlmClient } from './llm/types.js';
import type { Store } from './store.js';
import type { Tool } from './tools/types.js';
import type { Channel } from './whatsapp/types.js';

export type Runtime = {
  config: AppConfig;
  store: Store;
  llm: LlmClient;
  channel: Channel;
  log: Logger;
  tools: Tool[];
  now: () => Date;
  fetchImpl: typeof fetch;
};
