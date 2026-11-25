import { describe, expect, it } from 'vitest';
import { isPrivateIp } from '../src/net/safeUrl.js';
import { Store } from '../src/store.js';
import { fetchPageTool } from '../src/tools/fetchPage.js';
import { webSearchTool } from '../src/tools/search.js';
import type { ToolContext } from '../src/tools/types.js';

function context(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    phone: '15551234567',
    now: new Date('2026-11-25T17:00:00.000Z'),
    timezone: 'America/Los_Angeles',
    store: Store.open(':memory:'),
    fetchImpl: fetch,
    searchProvider: 'tavily',
    tavilyApiKey: 'tavily-test-key',
    braveApiKey: '',
    lookupImpl: async () => [{ address: '93.184.216.34' }],
    ...overrides,
  };
}

describe('tools', () => {
  it('formats Tavily results and does not send the key back to the model', async () => {
    let sawKey = false;
    const ctx = context({
      fetchImpl: async (_input, init) => {
        const body = JSON.parse(String(init?.body)) as { api_key?: string };
        sawKey = body.api_key === 'tavily-test-key';
        return Response.json({
          results: [{ title: 'Ferry times', url: 'https://example.com/ferry', content: 'Next boat at 4.' }],
        });
      },
    });
    const result = await webSearchTool().execute({ query: 'ferry building' }, ctx);
    expect(sawKey).toBe(true);
    expect(result).toContain('Ferry times');
    expect(result).toContain('https://example.com/ferry');
    expect(result).not.toContain('tavily-test-key');
  });

  it('says when search is not configured', async () => {
    const result = await webSearchTool().execute({ query: 'weather' }, context({ searchProvider: 'none' }));
    expect(result).toContain('not configured');
  });

  it('reads a public page and blocks private hosts', async () => {
    const tool = fetchPageTool();
    const page = await tool.execute(
      { url: 'https://example.com/notes' },
      context({
        fetchImpl: async () =>
          new Response('<html><style>body{}</style><h1>Notes</h1><p>Window seat.</p><script>alert(1)</script></html>', {
            headers: { 'content-type': 'text/html' },
          }),
      }),
    );
    expect(page).toContain('Window seat.');
    expect(page).not.toContain('alert');
    expect(page).not.toContain('<h1>');

    const blocked = await tool.execute({ url: 'http://127.0.0.1/latest/meta-data' }, context());
    expect(blocked).toContain('private');

    const rebinding = await tool.execute(
      { url: 'https://example.com/secret' },
      context({ lookupImpl: async () => [{ address: '169.254.169.254' }] }),
    );
    expect(rebinding).toContain('private');
  });

  it('recognizes private addresses', () => {
    expect(isPrivateIp('127.0.0.1')).toBe(true);
    expect(isPrivateIp('10.1.2.3')).toBe(true);
    expect(isPrivateIp('192.168.1.9')).toBe(true);
    expect(isPrivateIp('169.254.169.254')).toBe(true);
    expect(isPrivateIp('8.8.8.8')).toBe(false);
    expect(isPrivateIp('::1')).toBe(true);
  });
});
