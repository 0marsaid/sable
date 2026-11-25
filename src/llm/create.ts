import type { AppConfig } from '../config.js';
import { EchoLlm } from './echo.js';
import { OpenAiLlm } from './openai.js';
import type { LlmClient } from './types.js';

export function createLlm(config: AppConfig, fetchImpl: typeof fetch = fetch): LlmClient {
  if (config.llmMode === 'mock') return new EchoLlm();
  return new OpenAiLlm(config, fetchImpl);
}
