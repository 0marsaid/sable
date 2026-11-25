import { assertPublicHttpUrl, type LookupFn } from '../net/safeUrl.js';
import { clip, requiredText, type Tool } from './types.js';

const MAX_BYTES = 1_000_000;
const MAX_REDIRECTS = 3;

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<\/(p|div|h[1-6]|li|tr|br)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

async function readLimited(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > MAX_BYTES) {
      await reader.cancel();
      break;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function fetchPublic(
  start: URL,
  fetchImpl: typeof fetch,
  lookupFn: LookupFn | undefined,
): Promise<{ url: string; text: string }> {
  let current = start;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const response = await fetchImpl(current, {
      redirect: 'manual',
      headers: {
        accept: 'text/html, text/plain, application/json, application/xhtml+xml',
        'user-agent': 'SableAssistant/1.0',
      },
      signal: AbortSignal.timeout(12_000),
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) throw new Error(`The page redirected without a location (${response.status}).`);
      current = await assertPublicHttpUrl(new URL(location, current).toString(), lookupFn);
      continue;
    }
    if (!response.ok) throw new Error(`The page returned ${response.status}.`);
    const type = (response.headers.get('content-type') || '').toLowerCase();
    if (
      type &&
      !type.includes('text/') &&
      !type.includes('json') &&
      !type.includes('xml') &&
      !type.includes('html')
    ) {
      throw new Error(`That URL is ${type}, which I can't read as a page.`);
    }
    const raw = await readLimited(response);
    const text = type.includes('html') || raw.includes('<html') ? htmlToText(raw) : raw.trim();
    if (!text) throw new Error('The page had no readable text.');
    return { url: current.toString(), text: clip(text, 8000) };
  }
  throw new Error('The page redirected too many times.');
}

export function fetchPageTool(): Tool {
  return {
    name: 'fetch_page',
    sensitive: false,
    description:
      'Open a public http(s) URL and read its text. Use this after search, or when the user sends a link. Private and local addresses are blocked.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        url: { type: 'string', description: 'Absolute http or https URL' },
      },
      required: ['url'],
    },
    summarize: (args) => `Open ${String(args.url ?? '')}.`,
    validate: (args) => requiredText(args, 'url', 'url'),
    async execute(args, ctx) {
      try {
        const url = await assertPublicHttpUrl(String(args.url).trim(), ctx.lookupImpl);
        const page = await fetchPublic(url, ctx.fetchImpl, ctx.lookupImpl);
        return clip(`From ${page.url}:\n\n${page.text}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Could not open that page.';
        return `Could not open the page: ${message}`;
      }
    },
  };
}
