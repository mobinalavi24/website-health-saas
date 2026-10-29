import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import zlib from 'node:zlib';
import { Readable } from 'node:stream';

/**
 * SSRF defence layer for every outbound request that targets a user-supplied host.
 *
 * Key properties:
 *  - Blocks loopback, private, link-local, CGNAT, multicast, reserved, documentation,
 *    NAT64/6to4/Teredo-embedded and IPv4-mapped IPv6 destinations (IPv4 and IPv6 equally).
 *  - The destination IP is validated at *connect time* through a custom `lookup` function,
 *    so a DNS-rebinding answer that changes between validation and connection is rejected.
 *  - Every redirect hop is re-validated; redirect depth, response size and total time are capped.
 *  - Only http/https on an explicit port allowlist; no URL credentials.
 */

export class SsrfBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SsrfBlockedError';
  }
}

export const ALLOWED_PORTS = new Set([80, 443, 8080, 8443]);

const FORBIDDEN_HOSTNAMES = [
  'localhost',
  'metadata.google.internal',
  'metadata',
  'instance-data',
];
const FORBIDDEN_SUFFIXES = ['.localhost', '.local', '.internal', '.lan', '.home', '.corp', '.intranet', '.localdomain'];

const blockList = new net.BlockList();
const v4Ranges: Array<[string, number]> = [
  ['0.0.0.0', 8], // "this" network
  ['10.0.0.0', 8],
  ['100.64.0.0', 10], // CGNAT
  ['127.0.0.0', 8],
  ['169.254.0.0', 16], // link-local + cloud metadata
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved + broadcast
];
for (const [addr, prefix] of v4Ranges) blockList.addSubnet(addr, prefix, 'ipv4');
const v6Ranges: Array<[string, number]> = [
  ['::', 128],
  ['::1', 128],
  ['64:ff9b::', 96], // NAT64 (checked separately for embedded v4 as well)
  ['64:ff9b:1::', 48],
  ['100::', 64], // discard
  ['2001::', 32], // Teredo
  ['2001:db8::', 32], // documentation
  ['2002::', 16], // 6to4
  ['fc00::', 7], // unique local
  ['fe80::', 10], // link-local
  ['fec0::', 10], // site-local (deprecated)
  ['ff00::', 8], // multicast
];
for (const [addr, prefix] of v6Ranges) blockList.addSubnet(addr, prefix, 'ipv6');

/** Expand any textual IPv6 address into 16 bytes (supports :: compression and embedded dotted IPv4). */
function ipv6ToBytes(ip: string): number[] | null {
  let addr = ip.toLowerCase();
  const zone = addr.indexOf('%');
  if (zone !== -1) addr = addr.slice(0, zone);
  if (!net.isIPv6(addr)) return null;

  let tailV4: number[] | null = null;
  const lastColon = addr.lastIndexOf(':');
  const tail = addr.slice(lastColon + 1);
  if (tail.includes('.')) {
    const octets = tail.split('.').map(Number);
    if (octets.length !== 4 || octets.some((o) => !Number.isInteger(o) || o < 0 || o > 255)) return null;
    tailV4 = octets;
    addr = addr.slice(0, lastColon + 1) + '0:0';
  }

  const [head, rest] = addr.split('::');
  const headParts = head ? head.split(':') : [];
  const restParts = addr.includes('::') ? (rest ? rest.split(':') : []) : [];
  let groups: string[];
  if (addr.includes('::')) {
    const fill = 8 - headParts.length - restParts.length;
    if (fill < 0) return null;
    groups = [...headParts, ...Array(fill).fill('0'), ...restParts];
  } else {
    groups = headParts;
  }
  if (groups.length !== 8) return null;

  const bytes: number[] = [];
  for (const g of groups) {
    const v = parseInt(g || '0', 16);
    if (Number.isNaN(v) || v < 0 || v > 0xffff) return null;
    bytes.push((v >> 8) & 0xff, v & 0xff);
  }
  if (tailV4) {
    bytes[12] = tailV4[0];
    bytes[13] = tailV4[1];
    bytes[14] = tailV4[2];
    bytes[15] = tailV4[3];
  }
  return bytes;
}

/** Returns true when the address must never be contacted on behalf of a user. Fails closed on garbage. */
export function isBlockedIp(rawIp: string): boolean {
  if (!rawIp || typeof rawIp !== 'string') return true;
  const ip = rawIp.trim().replace(/^\[|\]$/g, '');

  if (net.isIPv4(ip)) {
    return blockList.check(ip, 'ipv4');
  }

  const bytes = ipv6ToBytes(ip);
  if (!bytes) return true;

  const isMappedV4 =
    bytes.slice(0, 10).every((b) => b === 0) && bytes[10] === 0xff && bytes[11] === 0xff;
  const isCompatV4 = bytes.slice(0, 12).every((b) => b === 0) && !bytes.slice(12).every((b) => b === 0);
  const isNat64 =
    bytes[0] === 0x00 && bytes[1] === 0x64 && bytes[2] === 0xff && bytes[3] === 0x9b && bytes.slice(4, 12).every((b) => b === 0);
  if (isMappedV4 || isCompatV4 || isNat64) {
    const v4 = bytes.slice(12).join('.');
    return isBlockedIp(v4) || isNat64 || isCompatV4;
  }

  const normalised = [];
  for (let i = 0; i < 16; i += 2) normalised.push(((bytes[i] << 8) | bytes[i + 1]).toString(16));
  return blockList.check(normalised.join(':'), 'ipv6');
}

export function stripIpBrackets(host: string): string {
  return host.replace(/^\[|\]$/g, '');
}

/** Static (pre-DNS) hostname policy. Throws SsrfBlockedError when rejected. */
export function assertHostnameAllowed(hostname: string): void {
  const host = stripIpBrackets((hostname || '').toLowerCase().replace(/\.$/, ''));
  if (!host || host.length > 253) throw new SsrfBlockedError('Invalid target host.');
  if (/[\s\u0000-\u001f\u007f]/.test(host)) throw new SsrfBlockedError('Invalid target host.');

  if (net.isIP(host)) {
    if (isBlockedIp(host)) throw new SsrfBlockedError('Access to private or reserved addresses is blocked.');
    return;
  }
  if (FORBIDDEN_HOSTNAMES.includes(host) || FORBIDDEN_SUFFIXES.some((s) => host.endsWith(s))) {
    throw new SsrfBlockedError('Access to internal hostnames is blocked.');
  }
  if (!host.includes('.')) {
    // Single-label names resolve through local search domains / hosts files.
    throw new SsrfBlockedError('Access to internal hostnames is blocked.');
  }
}

/**
 * Validates and parses a user supplied URL for outbound use.
 * Rejects non-http(s) schemes, embedded credentials, unsafe ports and internal hostnames.
 */
export function parseSafeUrl(raw: string): URL {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 2048) {
    throw new SsrfBlockedError('Invalid URL.');
  }
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new SsrfBlockedError('Invalid URL.');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new SsrfBlockedError('Unsupported URL scheme.');
  }
  if (parsed.username || parsed.password) {
    throw new SsrfBlockedError('URLs containing credentials are not allowed.');
  }
  const port = parsed.port ? Number(parsed.port) : parsed.protocol === 'https:' ? 443 : 80;
  if (!ALLOWED_PORTS.has(port)) {
    throw new SsrfBlockedError('Target port is not allowed.');
  }
  assertHostnameAllowed(parsed.hostname);
  return parsed;
}

/**
 * `lookup` implementation for http(s).request / tls.connect which validates the *resolved* IP at
 * connection time. This is what defeats DNS rebinding / TOCTOU: the socket can only ever connect
 * to an address that passed `isBlockedIp` in this very resolution.
 */
export function guardedLookup(
  hostname: string,
  options: any,
  callback: (err: NodeJS.ErrnoException | null, address?: any, family?: number) => void
): void {
  const opts = typeof options === 'object' && options ? options : { family: options };
  dns.lookup(hostname, { ...opts, all: true, verbatim: true }, (err, addresses) => {
    if (err) return callback(err);
    const list = (addresses as unknown as dns.LookupAddress[]) || [];
    if (list.length === 0) {
      return callback(Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' }));
    }
    // Any blocked answer poisons the whole result set (prevents mixed public/private answers).
    for (const a of list) {
      if (isBlockedIp(a.address)) {
        return callback(new SsrfBlockedError('Domain resolves to a protected address.') as any);
      }
    }
    if (opts.all) return callback(null, list);
    callback(null, list[0].address, list[0].family);
  });
}

/** Validates a hostname by resolving it once (used for cheap pre-flight checks and error messages). */
export async function validateResolvedHost(hostname: string): Promise<void> {
  assertHostnameAllowed(hostname);
  const host = stripIpBrackets(hostname);
  if (net.isIP(host)) return;
  const addresses = await new Promise<dns.LookupAddress[]>((resolve, reject) => {
    dns.lookup(host, { all: true, verbatim: true }, (err, res) => (err ? reject(err) : resolve(res)));
  }).catch(() => [] as dns.LookupAddress[]);
  for (const a of addresses) {
    if (isBlockedIp(a.address)) {
      throw new SsrfBlockedError('Domain resolves to a protected address. Scanning disallowed.');
    }
  }
}

export interface SafeResponse {
  status: number;
  statusText: string;
  headers: Headers;
  url: string;
  redirected: boolean;
  text(): Promise<string>;
}

export interface SafeFetchOptions {
  method?: 'GET' | 'HEAD';
  headers?: Record<string, string>;
  /** Total wall-clock budget for the whole redirect chain. */
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  /** When false, redirects are returned to the caller (status 3xx) instead of followed. */
  followRedirects?: boolean;
}

const DEFAULT_UA = 'PulseVanguarde-Monitor/1.0 (+https://pulsevanguard.com/bot; website health check)';

function decodeBody(res: http.IncomingMessage, maxBytes: number, deadline: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const encoding = String(res.headers['content-encoding'] || '').toLowerCase();
    let stream: Readable = res;
    if (encoding === 'gzip' || encoding === 'x-gzip') stream = res.pipe(zlib.createGunzip());
    else if (encoding === 'deflate') stream = res.pipe(zlib.createInflate());
    else if (encoding === 'br') stream = res.pipe(zlib.createBrotliDecompress());

    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err) reject(err);
      else resolve(Buffer.concat(chunks).toString('utf8'));
    };
    const timer = setTimeout(() => {
      res.destroy();
      finish(new Error('Response timed out.'));
    }, Math.max(1, deadline - Date.now()));

    stream.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) {
        // Truncate instead of failing: callers only need the head of the document.
        const keep = chunk.length - (size - maxBytes);
        if (keep > 0) chunks.push(chunk.subarray(0, keep));
        res.destroy();
        stream.destroy();
        finish();
        return;
      }
      chunks.push(chunk);
    });
    stream.on('end', () => finish());
    stream.on('error', (e) => finish(e));
    res.on('error', (e) => finish(e));
  });
}

function singleRequest(url: URL, opts: SafeFetchOptions, deadline: number): Promise<http.IncomingMessage> {
  return new Promise((resolve, reject) => {
    const isHttps = url.protocol === 'https:';
    const lib = isHttps ? https : http;
    const remaining = deadline - Date.now();
    if (remaining <= 0) return reject(new Error('Request timed out.'));

    const req = lib.request(
      {
        protocol: url.protocol,
        hostname: stripIpBrackets(url.hostname),
        port: url.port || (isHttps ? 443 : 80),
        path: `${url.pathname}${url.search}`,
        method: opts.method || 'GET',
        headers: {
          'User-Agent': DEFAULT_UA,
          'Accept-Encoding': 'gzip, deflate, br',
          Host: url.host,
          ...(opts.headers || {}),
        },
        lookup: guardedLookup as any,
        timeout: Math.min(remaining, 10000),
        agent: false,
        maxHeaderSize: 32 * 1024,
      } as https.RequestOptions,
      (res) => resolve(res)
    );
    const killer = setTimeout(() => req.destroy(new Error('Request timed out.')), remaining);
    req.on('timeout', () => req.destroy(new Error('Connection timed out.')));
    req.on('error', (e) => {
      clearTimeout(killer);
      reject(e);
    });
    req.on('close', () => clearTimeout(killer));
    req.end();
  });
}

/**
 * SSRF-hardened replacement for fetch() on user-controlled URLs.
 */
export async function safeFetch(rawUrl: string, options: SafeFetchOptions = {}): Promise<SafeResponse> {
  const timeoutMs = options.timeoutMs ?? 8000;
  const maxBytes = options.maxBytes ?? 1024 * 1024;
  const maxRedirects = options.maxRedirects ?? 5;
  const follow = options.followRedirects !== false;
  const deadline = Date.now() + timeoutMs;

  let current = parseSafeUrl(rawUrl);
  let hops = 0;
  let redirected = false;

  for (;;) {
    const res = await singleRequest(current, options, deadline);
    const status = res.statusCode || 0;

    if (follow && status >= 300 && status < 400 && res.headers.location) {
      res.resume();
      if (hops >= maxRedirects) {
        throw new Error('Too many redirects.');
      }
      let next: URL;
      try {
        next = new URL(String(res.headers.location), current);
      } catch {
        throw new SsrfBlockedError('Invalid redirect target.');
      }
      current = parseSafeUrl(next.toString()); // revalidates scheme, port, credentials, hostname
      hops++;
      redirected = true;
      continue;
    }

    const headers = new Headers();
    for (const [k, v] of Object.entries(res.headers)) {
      if (Array.isArray(v)) v.forEach((x) => headers.append(k, x));
      else if (v !== undefined) headers.set(k, String(v));
    }

    let bodyPromise: Promise<string> | null = null;
    const readBody = () => {
      if (!bodyPromise) {
        bodyPromise =
          (opts_isHead(options) || status === 204 || status === 304)
            ? (res.resume(), Promise.resolve(''))
            : decodeBody(res, maxBytes, deadline);
      }
      return bodyPromise;
    };

    return {
      status,
      statusText: res.statusMessage || '',
      headers,
      url: current.toString(),
      redirected,
      text: () => readBody().catch(() => ''),
    };
  }
}

function opts_isHead(o: SafeFetchOptions): boolean {
  return (o.method || 'GET') === 'HEAD';
}
