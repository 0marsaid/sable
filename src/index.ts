import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { llmReady, loadConfig, metaReady, searchReady, secretValues, twilioReady } from './config.js';
import { loadDotEnv } from './env.js';
import { createLogger, errorMessage } from './logger.js';
import { createLlm } from './llm/create.js';
import { formatPhone, maskPhone } from './phone.js';
import type { Runtime } from './runtime.js';
import { Store } from './store.js';
import { createTools } from './tools/registry.js';
import { createChannel } from './whatsapp/create.js';

loadDotEnv();

const config = loadConfig(process.env);
const log = createLogger({ level: config.logLevel, secrets: secretValues(config) });
const store = Store.open(config.databasePath);
const fetchImpl = fetch;
const runtime: Runtime = {
  config,
  store,
  llm: createLlm(config, fetchImpl),
  channel: createChannel(config, fetchImpl),
  log,
  tools: createTools(),
  now: () => new Date(),
  fetchImpl,
};

const recovered = store.recoverStuckReminders(new Date(Date.now() - 2 * 60 * 1000).toISOString());
if (recovered > 0) log.warn({ recovered }, 'reset reminders that were stuck sending');

if (config.ownerPhones.length === 0) {
  log.warn({}, 'OWNER_PHONE_NUMBERS is empty, so every inbound message will be ignored');
} else {
  log.info({ owners: config.ownerPhones.map((phone) => maskPhone(formatPhone(phone))) }, 'allowlist loaded');
}
if (config.timezoneWasInvalid) log.warn({}, 'OWNER_TIMEZONE was invalid, using UTC');
if (config.whatsappProvider === 'console') {
  log.warn({}, 'console WhatsApp adapter is for a local dry run — do not expose it on the public internet');
}
if (config.whatsappProvider === 'meta' && !metaReady(config)) {
  log.warn({}, 'Meta WhatsApp credentials are incomplete');
}
if (config.whatsappProvider === 'meta' && !config.metaAppSecret) {
  log.warn({}, 'META_APP_SECRET is unset, so webhook signature checks are off');
}
if (config.whatsappProvider === 'twilio' && !twilioReady(config)) {
  log.warn({}, 'Twilio credentials are incomplete');
}
if (config.whatsappProvider === 'twilio' && config.twilioAuthToken && !config.publicBaseUrl) {
  log.warn({}, 'PUBLIC_BASE_URL is unset, so Twilio signature checks are off');
}
if (!llmReady(config)) log.warn({}, 'no LLM API key set; the bot will say it is not configured');
if (config.llmMode === 'mock') log.warn({}, 'LLM_MODE=mock echoes messages and does not call tools');
if (!searchReady(config)) log.info({ provider: config.searchProvider }, 'web search is off');

const { app, runScheduler } = createApp(runtime);
const timer = setInterval(() => {
  runScheduler().catch((error: unknown) => {
    log.error({ err: errorMessage(error) }, 'scheduler tick failed');
  });
}, config.schedulerIntervalMs);
timer.unref();

const server = serve(
  { fetch: app.fetch, port: config.port, hostname: config.host },
  (info) => {
    log.info(
      { port: info.port, host: config.host, provider: config.whatsappProvider },
      `${config.assistantName} listening`,
    );
  },
);

let closing = false;
function shutdown(): void {
  if (closing) return;
  closing = true;
  clearInterval(timer);
  server.close(() => {
    store.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 3000).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
