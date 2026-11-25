import { lookup } from 'node:dns/promises';

export type LookupFn = (hostname: string) => Promise<{ address: string }[]>;

const BLOCKED_HOSTS = new Set(['localhost', 'metadata.google.internal']);

export function isPrivateIp(address: string): boolean {
  const ip = address.toLowerCase().replace(/^\[|\]$/g, '');
  if (ip === '::1' || ip === '::') return true;
  if (ip.startsWith('fe80:') || ip.startsWith('fc') || ip.startsWith('fd')) return true;

  const mapped = ip.startsWith('::ffff:') ? ip.slice('::ffff:'.length) : ip;
  const parts = mapped.split('.').map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 192 && b === 0 && parts[2] === 2) return true;
  if (a === 198 && (b === 18 || b === 19 || b === 51)) return true;
  if (a >= 224) return true;
  return false;
}

function blockedHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  if (BLOCKED_HOSTS.has(host)) return true;
  if (host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.localhost')) return true;
  if (isPrivateIp(host)) return true;
  return false;
}

async function defaultLookup(hostname: string): Promise<{ address: string }[]> {
  const results = await lookup(hostname, { all: true, verbatim: true });
  return results.map((result) => ({ address: result.address }));
}

/**
 * Allow only public http(s) URLs. Used by fetch_page so a prompt cannot
 * point the bot at the host's own network or the cloud metadata service.
 */
export async function assertPublicHttpUrl(raw: string, lookupFn: LookupFn = defaultLookup): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('That is not a valid URL.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Only http and https links can be opened.');
  }
  if (url.username || url.password) {
    throw new Error('Links with a username or password are blocked.');
  }
  if (blockedHostname(url.hostname)) {
    throw new Error('That host is on a private network and is blocked.');
  }
  let addresses: { address: string }[];
  try {
    addresses = await lookupFn(url.hostname);
  } catch {
    throw new Error(`Could not resolve ${url.hostname}.`);
  }
  if (addresses.length === 0 || addresses.some((item) => isPrivateIp(item.address))) {
    throw new Error('That host resolves to a private network and is blocked.');
  }
  return url;
}
