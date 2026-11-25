import { describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../src/config.js';
import { createLogger } from '../src/logger.js';
import { OpenAiLlm } from '../src/llm/openai.js';
import { createTestApp } from './helpers.js';

describe('secrets', () => {
  it('redacts configured secrets from logs', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const log = createLogger({ level: 'info', secrets: ['sk-live-secret-value'] });
    log.info({ detail: 'provider said sk-live-secret-value' }, 'request failed');
    expect(spy.mock.calls[0]?.[0]).toContain('[redacted]');
    expect(spy.mock.calls[0]?.[0]).not.toContain('sk-live-secret-value');
    spy.mockRestore();
  });

  it('does not put the API key on the status page or the health check', async () => {
    const harness = createTestApp({
      env: { LLM_MODE: 'openai', LLM_API_KEY: 'sk-live-secret-value', LLM_MODEL: 'gpt-4o-mini' },
    });
    const home = await harness.app.request('/');
    const health = await harness.app.request('/health');
    const html = await home.text();
    const body = await health.text();
    expect(html).not.toContain('sk-live-secret-value');
    expect(body).not.toContain('sk-live-secret-value');
    expect(html).toContain('Sable');
    expect(body).toContain('"ok":true');
  });

  it('strips the API key from a failed model response', async () => {
    const config = loadConfig({
      LLM_API_KEY: 'sk-live-secret-value',
      LLM_BASE_URL: 'https://example.test/v1',
      LLM_MODEL: 'gpt-4o-mini',
    } as NodeJS.ProcessEnv);
    const fetchImpl: typeof fetch = async () => new Response('bad key sk-live-secret-value', { status: 401 });
    const llm = new OpenAiLlm(config, fetchImpl);
    await expect(
      llm.chat({
        messages: [{ role: 'user', content: 'Hi' }],
        tools: [],
      }),
    ).rejects.toThrow(/401/);
    await expect(
      llm.chat({
        messages: [{ role: 'user', content: 'Hi' }],
        tools: [],
      }),
    ).rejects.toThrow(/\[redacted\]/);
  });
});
