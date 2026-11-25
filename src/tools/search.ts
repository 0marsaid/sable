import { isRecord } from '../json.js';
import { clip, requiredText, type Tool } from './types.js';

type Hit = { title: string; url: string; snippet: string };

async function searchTavily(query: string, apiKey: string, fetchImpl: typeof fetch): Promise<Hit[]> {
  const response = await fetchImpl('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ api_key: apiKey, query, max_results: 5, search_depth: 'basic' }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Tavily returned ${response.status}`);
  const body: unknown = await response.json();
  if (!isRecord(body) || !Array.isArray(body.results)) return [];
  return body.results.slice(0, 5).map((item) => {
    const row = isRecord(item) ? item : {};
    return {
      title: typeof row.title === 'string' ? row.title : 'Untitled',
      url: typeof row.url === 'string' ? row.url : '',
      snippet: typeof row.content === 'string' ? row.content : '',
    };
  });
}

async function searchBrave(query: string, apiKey: string, fetchImpl: typeof fetch): Promise<Hit[]> {
  const url = new URL('https://api.search.brave.com/res/v1/web/search');
  url.searchParams.set('q', query);
  url.searchParams.set('count', '5');
  const response = await fetchImpl(url, {
    headers: { accept: 'application/json', 'x-subscription-token': apiKey },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Brave returned ${response.status}`);
  const body: unknown = await response.json();
  const web = isRecord(body) && isRecord(body.web) ? body.web : null;
  const results = web && Array.isArray(web.results) ? web.results : [];
  return results.slice(0, 5).map((item) => {
    const row = isRecord(item) ? item : {};
    return {
      title: typeof row.title === 'string' ? row.title : 'Untitled',
      url: typeof row.url === 'string' ? row.url : '',
      snippet: typeof row.description === 'string' ? row.description : '',
    };
  });
}

function formatHits(query: string, hits: Hit[]): string {
  if (hits.length === 0) return `No results for “${query}”.`;
  return hits
    .map((hit, index) => `${index + 1}. ${hit.title}\n${hit.url}\n${hit.snippet}`.trim())
    .join('\n\n');
}

export function webSearchTool(): Tool {
  return {
    name: 'web_search',
    sensitive: false,
    description:
      'Search the public web. Use this for news, facts, opening hours, and anything that may have changed since training.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        query: { type: 'string', description: 'Search query' },
      },
      required: ['query'],
    },
    summarize: (args) => `Search the web for “${String(args.query ?? '')}”.`,
    validate: (args) => requiredText(args, 'query', 'query'),
    async execute(args, ctx) {
      const query = String(args.query).trim().slice(0, 400);
      if (ctx.searchProvider === 'none') {
        return 'Web search is not configured. Set SEARCH_PROVIDER to tavily or brave and add the matching API key.';
      }
      try {
        const hits =
          ctx.searchProvider === 'brave'
            ? await searchBrave(query, ctx.braveApiKey, ctx.fetchImpl)
            : await searchTavily(query, ctx.tavilyApiKey, ctx.fetchImpl);
        return clip(formatHits(query, hits));
      } catch (error) {
        const message = error instanceof Error ? error.message : 'search failed';
        return `Web search failed: ${message}`;
      }
    },
  };
}
