import { parseAllowlist } from './phone.js';
import { isValidTimeZone } from './time.js';

export type ChannelName = 'web' | 'whatsapp';
export type WhatsAppProviderName = 'meta' | 'twilio' | 'console';
export type SearchProviderName = 'tavily' | 'brave' | 'none';
export type LlmMode = 'openai' | 'mock';

export type AppConfig = {
  port: number;
  host: string;
  assistantName: string;
  ownerName: string;
  ownerPhones: string[];
  databasePath: string;
  timezone: string;
  timezoneWasInvalid: boolean;
  logLevel: string;
  publicBaseUrl: string;
  historyLimit: number;
  schedulerIntervalMs: number;

  llmMode: LlmMode;
  llmBaseUrl: string;
  llmApiKey: string;
  llmModel: string;
  llmVisionModel: string;

  whatsappProvider: WhatsAppProviderName;
  metaVerifyToken: string;
  metaAccessToken: string;
  metaPhoneNumberId: string;
  metaAppSecret: string;
  metaApiVersion: string;
  metaReminderTemplate: string;
  metaReminderTemplateLang: string;

  twilioAccountSid: string;
  twilioAuthToken: string;
  twilioWhatsappFrom: string;

  searchProvider: SearchProviderName;
  tavilyApiKey: string;
  braveApiKey: string;

  channel: ChannelName;
  appPassword: string;
};

function str(env: NodeJS.ProcessEnv, key: string): string {
  return (env[key] ?? '').trim();
}

function chooseChannel(env: NodeJS.ProcessEnv): ChannelName {
  const raw = str(env, 'CHANNEL').toLowerCase();
  if (raw === 'web' || raw === 'whatsapp') return raw;
  const explicit = str(env, 'WHATSAPP_PROVIDER').toLowerCase();
  if (explicit === 'meta' || explicit === 'twilio' || explicit === 'console') return 'whatsapp';
  if (str(env, 'META_ACCESS_TOKEN') && str(env, 'META_PHONE_NUMBER_ID')) return 'whatsapp';
  if (str(env, 'TWILIO_ACCOUNT_SID') && str(env, 'TWILIO_AUTH_TOKEN')) return 'whatsapp';
  return 'web';
}

function chooseProvider(env: NodeJS.ProcessEnv): WhatsAppProviderName {
  const raw = str(env, 'WHATSAPP_PROVIDER').toLowerCase();
  if (raw === 'meta' || raw === 'twilio' || raw === 'console') return raw;
  if (str(env, 'META_ACCESS_TOKEN') && str(env, 'META_PHONE_NUMBER_ID')) return 'meta';
  if (str(env, 'TWILIO_ACCOUNT_SID') && str(env, 'TWILIO_AUTH_TOKEN')) return 'twilio';
  return 'console';
}

function chooseSearch(env: NodeJS.ProcessEnv): SearchProviderName {
  const raw = str(env, 'SEARCH_PROVIDER').toLowerCase();
  if (raw === 'tavily' || raw === 'brave' || raw === 'none') return raw;
  if (str(env, 'TAVILY_API_KEY')) return 'tavily';
  if (str(env, 'BRAVE_API_KEY')) return 'brave';
  return 'none';
}

export function loadConfig(env: NodeJS.ProcessEnv): AppConfig {
  const port = Number(str(env, 'PORT') || '8787');
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer from 1 to 65535');
  }

  const requestedTz = str(env, 'OWNER_TIMEZONE') || 'UTC';
  const timezoneWasInvalid = !isValidTimeZone(requestedTz);
  const llmMode: LlmMode = str(env, 'LLM_MODE').toLowerCase() === 'mock' ? 'mock' : 'openai';
  const base = (str(env, 'LLM_BASE_URL') || 'https://api.openai.com/v1').replace(/\/+$/, '');

  return {
    port,
    host: str(env, 'HOST') || '0.0.0.0',
    assistantName: str(env, 'ASSISTANT_NAME') || 'Sable',
    ownerName: str(env, 'OWNER_NAME') || 'Omar',
    ownerPhones: parseAllowlist(str(env, 'OWNER_PHONE_NUMBERS')),
    databasePath: str(env, 'DATABASE_PATH') || './data/sable.db',
    timezone: timezoneWasInvalid ? 'UTC' : requestedTz,
    timezoneWasInvalid,
    logLevel: (str(env, 'LOG_LEVEL') || 'info').toLowerCase(),
    publicBaseUrl: str(env, 'PUBLIC_BASE_URL').replace(/\/+$/, ''),
    historyLimit: 40,
    schedulerIntervalMs: 15_000,

    llmMode,
    llmBaseUrl: base,
    llmApiKey: str(env, 'LLM_API_KEY'),
    llmModel: str(env, 'LLM_MODEL') || 'gpt-4o-mini',
    llmVisionModel: str(env, 'LLM_VISION_MODEL'),

    whatsappProvider: chooseProvider(env),
    metaVerifyToken: str(env, 'META_VERIFY_TOKEN'),
    metaAccessToken: str(env, 'META_ACCESS_TOKEN'),
    metaPhoneNumberId: str(env, 'META_PHONE_NUMBER_ID'),
    metaAppSecret: str(env, 'META_APP_SECRET'),
    metaApiVersion: str(env, 'META_API_VERSION') || 'v21.0',
    metaReminderTemplate: str(env, 'META_REMINDER_TEMPLATE'),
    metaReminderTemplateLang: str(env, 'META_REMINDER_TEMPLATE_LANG') || 'en',

    twilioAccountSid: str(env, 'TWILIO_ACCOUNT_SID'),
    twilioAuthToken: str(env, 'TWILIO_AUTH_TOKEN'),
    twilioWhatsappFrom: str(env, 'TWILIO_WHATSAPP_FROM') || 'whatsapp:+14155238886',

    searchProvider: chooseSearch(env),
    tavilyApiKey: str(env, 'TAVILY_API_KEY'),
    braveApiKey: str(env, 'BRAVE_API_KEY'),

    channel: chooseChannel(env),
    appPassword: str(env, 'APP_PASSWORD'),
  };
}

export function secretValues(config: AppConfig): string[] {
  return [
    config.llmApiKey,
    config.metaAccessToken,
    config.metaAppSecret,
    config.metaVerifyToken,
    config.twilioAuthToken,
    config.tavilyApiKey,
    config.braveApiKey,
    config.appPassword,
  ].filter((value) => value.length >= 6);
}

export function metaReady(config: AppConfig): boolean {
  return Boolean(config.metaAccessToken && config.metaPhoneNumberId && config.metaVerifyToken);
}

export function twilioReady(config: AppConfig): boolean {
  return Boolean(config.twilioAccountSid && config.twilioAuthToken && config.twilioWhatsappFrom);
}

export function llmReady(config: AppConfig): boolean {
  return config.llmMode === 'mock' || Boolean(config.llmApiKey);
}

export function searchReady(config: AppConfig): boolean {
  if (config.searchProvider === 'tavily') return Boolean(config.tavilyApiKey);
  if (config.searchProvider === 'brave') return Boolean(config.braveApiKey);
  return false;
}
