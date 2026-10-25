import { validateTargetSecurity } from './scanner.ts';

export interface WhoisContactInfo {
  organization: string | null;
  name: string | null;
  email: string | null;
  phone: string | null;
  country: string | null;
  state: string | null;
  city: string | null;
  redacted: boolean;
}

export interface WhoisLookupResult {
  domainName: string;
  registrar: string | null;
  registrarIanaId: string | null;
  registrarUrl: string | null;
  abuseContactEmail: string | null;
  abuseContactPhone: string | null;
  registrationDate: string | null;
  updatedDate: string | null;
  expirationDate: string | null;
  daysUntilExpiration: number | null;
  statusCodes: string[];
  nameServers: string[];
  dnssec: string | null;
  registrant: WhoisContactInfo | null;
  adminContact: WhoisContactInfo | null;
  techContact: WhoisContactInfo | null;
  checkedAt: string;
  cached: boolean;
  provider: string;
  privacyRedacted: boolean;
  notices: string[];
  providerError: string | null;
}

// Cache WHOIS lookups for 1 hour to respect provider rate limits and terms
interface WhoisCacheEntry {
  data: WhoisLookupResult;
  timestamp: number;
}
const whoisCache = new Map<string, WhoisCacheEntry>();
const WHOIS_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

// Global rate limit for outbound WHOIS provider calls (max 30 lookups per minute)
const recentLookups: number[] = [];
const RATE_LIMIT_MAX = 30;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;

function checkWhoisRateLimit(): boolean {
  const now = Date.now();
  while (recentLookups.length > 0 && recentLookups[0] < now - RATE_LIMIT_WINDOW_MS) {
    recentLookups.shift();
  }
  if (recentLookups.length >= RATE_LIMIT_MAX) {
    return false;
  }
  recentLookups.push(now);
  return true;
}

/**
 * Strictly validates and normalizes a domain name for WHOIS lookup.
 * - Accepts domain names only.
 * - Rejects arbitrary URLs (http://, https://), paths (/...), query strings, ports (:80), IPv4/IPv6 addresses, localhost, and malformed input.
 */
export function validateAndNormalizeWhoisDomain(rawInput: string): string {
  if (!rawInput || typeof rawInput !== 'string') {
    throw new Error('A valid domain name is required for WHOIS lookup.');
  }

  const trimmed = rawInput.trim().toLowerCase().replace(/\.$/, '');
  if (!trimmed || trimmed.length > 253) {
    throw new Error('Invalid domain name length.');
  }

  // Reject URLs, schemes, paths, queries, fragments, ports, credentials, or whitespace
  if (
    trimmed.includes('://') ||
    trimmed.includes('/') ||
    trimmed.includes('?') ||
    trimmed.includes('#') ||
    trimmed.includes('@') ||
    trimmed.includes(':') ||
    /\s/.test(trimmed)
  ) {
    throw new Error('WHOIS lookup accepts domain names only. URLs, paths, ports, and IPv6 literals are not allowed.');
  }

  // Reject IPv4 addresses
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(trimmed)) {
    throw new Error('WHOIS lookup accepts domain names only. IP-based requests are not permitted.');
  }

  // Strip leading www. if present so the registrable domain is queried
  const normalized = trimmed.startsWith('www.') && trimmed.split('.').length > 2 ? trimmed.slice(4) : trimmed;

  // Reject reserved/internal domains
  if (
    normalized === 'localhost' ||
    normalized.endsWith('.localhost') ||
    normalized.endsWith('.local') ||
    normalized.endsWith('.internal') ||
    normalized.endsWith('.arpa') ||
    normalized.endsWith('.lan') ||
    normalized.endsWith('.home')
  ) {
    throw new Error('WHOIS lookup is not permitted for local, internal, or reserved domains.');
  }

  const labels = normalized.split('.');
  if (labels.length < 2) {
    throw new Error('Invalid domain name: must include a registrable domain and top-level domain (e.g. example.com).');
  }

  const labelRegex = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;
  for (const label of labels) {
    if (!label || !labelRegex.test(label)) {
      throw new Error(`Invalid domain label "${label}". Only valid hostname characters are allowed.`);
    }
  }

  const tld = labels[labels.length - 1];
  if (!/^(?:[a-z]{2,63}|xn--[a-z0-9-]{2,59})$/i.test(tld)) {
    throw new Error(`Invalid top-level domain ".${tld}".`);
  }

  return normalized;
}

function redactSecret(msg: string, secret?: string): string {
  let out = msg.replace(/([?&](?:apiKey|key|api_key|token)=)[^&\s]+/gi, '$1[REDACTED]');
  if (secret && secret.trim().length >= 4) {
    out = out.split(secret.trim()).join('[REDACTED]');
  }
  return out;
}

function parseIsoDateOrNull(val: unknown): string | null {
  if (!val || typeof val !== 'string') return null;
  const trimmed = val.trim();
  if (!trimmed) return null;
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return trimmed;
  return parsed.toISOString();
}

function computeDaysUntilExpiration(expirationIso: string | null): number | null {
  if (!expirationIso) return null;
  const expMs = new Date(expirationIso).getTime();
  if (Number.isNaN(expMs)) return null;
  return Math.ceil((expMs - Date.now()) / (24 * 60 * 60 * 1000));
}

function isRedactedText(val: unknown): boolean {
  if (typeof val !== 'string') return false;
  return /redacted|privacy|data protected|not disclosed|gdpr| statutory/i.test(val);
}

function mapGenericContact(raw: any): WhoisContactInfo | null {
  if (!raw || typeof raw !== 'object') return null;
  const org = raw.organization || raw.org || raw.company || null;
  const name = raw.name || raw.fullName || raw.contactName || null;
  const email = raw.email || raw.contactEmail || null;
  const phone = raw.telephone || raw.phone || raw.fax || null;
  const country = raw.country || raw.countryCode || raw.country_code || null;
  const state = raw.state || raw.province || raw.region || null;
  const city = raw.city || null;
  const redacted =
    Boolean(raw.redacted) ||
    isRedactedText(org) ||
    isRedactedText(name) ||
    isRedactedText(email);

  if (!org && !name && !email && !phone && !country && !state && !city && !redacted) {
    return null;
  }

  return {
    organization: org ? String(org) : null,
    name: name ? String(name) : null,
    email: email ? String(email) : null,
    phone: phone ? String(phone) : null,
    country: country ? String(country) : null,
    state: state ? String(state) : null,
    city: city ? String(city) : null,
    redacted,
  };
}

/**
 * Inspects server-side WHOIS environment configuration without exposing any secret values.
 */
export function getWhoisConfig(): {
  hasApiKey: boolean;
  provider: 'whoisxmlapi' | 'ip2whois' | 'whoisfreaks' | 'apininjas' | 'apilayer' | 'whoisjson' | 'custom' | 'iana-rdap';
  requireApiKey: boolean;
  diagnosticError?: string;
} {
  const rawKey = (process.env.WHOIS_API_KEY || '').trim();
  const isPlaceholder =
    !rawKey ||
    rawKey.startsWith('YOUR_') ||
    rawKey.startsWith('MY_') ||
    rawKey.startsWith('REPLACE_');
  const hasApiKey = !isPlaceholder;
  const requireApiKey = process.env.WHOIS_REQUIRE_API_KEY === 'true';

  const rawProvider = (process.env.WHOIS_API_PROVIDER || '').trim().toLowerCase();
  const customUrl = (process.env.WHOIS_API_URL || '').trim();

  if (!hasApiKey) {
    if (requireApiKey) {
      return {
        hasApiKey: false,
        provider: 'iana-rdap',
        requireApiKey: true,
        diagnosticError:
          'WHOIS_API_KEY is not configured on the server. Please set WHOIS_API_KEY (and optionally WHOIS_API_PROVIDER) in your server environment configuration.',
      };
    }
    return {
      hasApiKey: false,
      provider: 'iana-rdap',
      requireApiKey: false,
    };
  }

  if (customUrl) {
    return { hasApiKey: true, provider: 'custom', requireApiKey };
  }
  if (rawProvider === 'whoisxmlapi' || rawKey.startsWith('at_')) {
    return { hasApiKey: true, provider: 'whoisxmlapi', requireApiKey };
  }
  if (rawProvider === 'ip2whois') {
    return { hasApiKey: true, provider: 'ip2whois', requireApiKey };
  }
  if (rawProvider === 'whoisfreaks') {
    return { hasApiKey: true, provider: 'whoisfreaks', requireApiKey };
  }
  if (rawProvider === 'apininjas' || rawProvider === 'api-ninjas') {
    return { hasApiKey: true, provider: 'apininjas', requireApiKey };
  }
  if (rawProvider === 'apilayer') {
    return { hasApiKey: true, provider: 'apilayer', requireApiKey };
  }
  if (rawProvider === 'whoisjson') {
    return { hasApiKey: true, provider: 'whoisjson', requireApiKey };
  }
  // Auto-detect based on key structure if WHOIS_API_PROVIDER was not explicitly set
  if (/^[A-F0-9]{32}$/i.test(rawKey)) {
    return { hasApiKey: true, provider: 'ip2whois', requireApiKey };
  }
  if (/^[a-f0-9]{32}$/i.test(rawKey) || rawKey.includes('-')) {
    return { hasApiKey: true, provider: 'whoisfreaks', requireApiKey };
  }
  return { hasApiKey: true, provider: 'whoisxmlapi', requireApiKey };
}

/**
 * Queries a configured commercial WHOIS API provider using WHOIS_API_KEY.
 */
async function queryConfiguredApiProvider(
  domain: string,
  provider: string,
  apiKey: string
): Promise<WhoisLookupResult> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);

  try {
    let url = '';
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'User-Agent': 'PulseVanguard-Monitor/1.0 (+https://pulsevanguard.com; whois-audit)',
    };

    if (provider === 'custom') {
      const template = (process.env.WHOIS_API_URL || '').trim();
      if (template.includes('{domain}') || template.includes('{key}')) {
        url = template
          .replace(/\{domain\}/g, encodeURIComponent(domain))
          .replace(/\{key\}/g, encodeURIComponent(apiKey));
      } else {
        const parsed = new URL(template);
        parsed.searchParams.set('domain', domain);
        url = parsed.toString();
        headers['X-Api-Key'] = apiKey;
        headers['Authorization'] = `Bearer ${apiKey}`;
      }
    } else if (provider === 'whoisxmlapi') {
      url = `https://www.whoisxmlapi.com/whoisserver/WhoisService?apiKey=${encodeURIComponent(apiKey)}&domainName=${encodeURIComponent(domain)}&outputFormat=JSON`;
    } else if (provider === 'ip2whois') {
      url = `https://api.ip2whois.com/v2?key=${encodeURIComponent(apiKey)}&domain=${encodeURIComponent(domain)}`;
    } else if (provider === 'whoisfreaks') {
      url = `https://api.whoisfreaks.com/v1.0/whois?apiKey=${encodeURIComponent(apiKey)}&whois=live&domainName=${encodeURIComponent(domain)}`;
    } else if (provider === 'apininjas') {
      url = `https://api.api-ninjas.com/v1/whois?domain=${encodeURIComponent(domain)}`;
      headers['X-Api-Key'] = apiKey;
    } else if (provider === 'apilayer') {
      url = `https://api.apilayer.com/whois/query?domain=${encodeURIComponent(domain)}`;
      headers['apikey'] = apiKey;
    } else if (provider === 'whoisjson') {
      url = `https://whoisjson.com/api/v1/whois?domain=${encodeURIComponent(domain)}`;
      headers['Authorization'] = `TOKEN=${apiKey}`;
    } else {
      throw new Error(`Unsupported WHOIS_API_PROVIDER "${provider}".`);
    }

    const res = await fetch(url, {
      method: 'GET',
      headers,
      signal: controller.signal,
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      const safeBody = redactSecret(errBody.slice(0, 200), apiKey);
      if (res.status === 401 || res.status === 403) {
        throw new Error(`WHOIS provider authentication failed (HTTP ${res.status}). Verify WHOIS_API_KEY and WHOIS_API_PROVIDER.`);
      }
      if (res.status === 429) {
        throw new Error('WHOIS provider rate limit reached. Please wait before retrying.');
      }
      throw new Error(`WHOIS provider returned HTTP ${res.status}: ${safeBody || res.statusText}`);
    }

    const json: any = await res.json();
    const record = json.WhoisRecord || json.result || json;
    const registryData = record.registryData || record;

    const registrar =
      record.registrarName ||
      record.registrar?.name ||
      (typeof record.registrar === 'string' ? record.registrar : null) ||
      record.domain_registrar?.registrar_name ||
      null;
    const registrarIanaId =
      record.registrarIANAID ||
      record.registrar?.iana_id ||
      record.domain_registrar?.iana_id ||
      null;
    const registrarUrl =
      record.registrar?.url ||
      record.domain_registrar?.website_url ||
      null;
    const abuseContactEmail =
      record.contactEmail ||
      record.registrar?.email ||
      record.domain_registrar?.email_address ||
      null;
    const abuseContactPhone =
      record.registrar?.phone ||
      record.domain_registrar?.phone_number ||
      null;

    const registrationDate = parseIsoDateOrNull(
      record.createdDateNormalized ||
        record.createdDate ||
        registryData.createdDate ||
        record.create_date ||
        record.creation_date
    );
    const updatedDate = parseIsoDateOrNull(
      record.updatedDateNormalized ||
        record.updatedDate ||
        registryData.updatedDate ||
        record.update_date ||
        record.updated_date
    );
    const expirationDate = parseIsoDateOrNull(
      record.expiresDateNormalized ||
        record.expiresDate ||
        registryData.expiresDate ||
        record.expire_date ||
        record.expiry_date ||
        record.expiration_date
    );

    let statusCodes: string[] = [];
    const rawStatus = record.status || registryData.status || record.domain_status;
    if (Array.isArray(rawStatus)) {
      statusCodes = rawStatus.map((s) => String(s).trim()).filter(Boolean);
    } else if (typeof rawStatus === 'string') {
      statusCodes = rawStatus
        .split(/[\s,]+/)
        .map((s) => s.trim())
        .filter((s) => s && !s.startsWith('http'));
    }

    let nameServers: string[] = [];
    const rawNs =
      record.nameServers?.hostNames ||
      registryData.nameServers?.hostNames ||
      record.nameservers ||
      record.name_servers;
    if (Array.isArray(rawNs)) {
      nameServers = rawNs
        .map((n: any) => (typeof n === 'string' ? n : n?.host || n?.name || ''))
        .map((s: string) => s.trim().toLowerCase())
        .filter(Boolean);
    }

    const registrant = mapGenericContact(record.registrant || registryData.registrant || record.registrant_contact);
    const adminContact = mapGenericContact(record.administrativeContact || registryData.administrativeContact || record.admin || record.administrative_contact);
    const techContact = mapGenericContact(record.technicalContact || registryData.technicalContact || record.tech || record.technical_contact);

    const privacyRedacted = Boolean(
      registrant?.redacted ||
        adminContact?.redacted ||
        techContact?.redacted ||
        statusCodes.some((s) => /privacy|redacted/i.test(s))
    );

    const dnssec =
      record.dnssec !== undefined && record.dnssec !== null
        ? String(record.dnssec)
        : null;

    return {
      domainName: String(record.domainName || record.domain || record.domain_name || domain).toLowerCase(),
      registrar: registrar ? String(registrar) : null,
      registrarIanaId: registrarIanaId ? String(registrarIanaId) : null,
      registrarUrl: registrarUrl ? String(registrarUrl) : null,
      abuseContactEmail: abuseContactEmail ? String(abuseContactEmail) : null,
      abuseContactPhone: abuseContactPhone ? String(abuseContactPhone) : null,
      registrationDate,
      updatedDate,
      expirationDate,
      daysUntilExpiration: computeDaysUntilExpiration(expirationDate),
      statusCodes: Array.from(new Set(statusCodes)),
      nameServers: Array.from(new Set(nameServers)),
      dnssec,
      registrant,
      adminContact,
      techContact,
      checkedAt: new Date().toISOString(),
      cached: false,
      provider: `whois-api (${provider})`,
      privacyRedacted,
      notices: [],
      providerError: null,
    };
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      throw new Error('WHOIS lookup timed out after 15 seconds.');
    }
    throw new Error(redactSecret(err?.message || 'WHOIS provider lookup failed.', apiKey));
  } finally {
    clearTimeout(timeoutId);
  }
}

// Cache IANA RDAP bootstrap table in memory so we can resolve authoritative TLD RDAP servers directly
let ianaBootstrapCache: { services: [string[], string[]][]; fetchedAt: number } | null = null;

async function resolveRdapBaseUrlForDomain(domain: string): Promise<string[]> {
  const tld = domain.split('.').pop()?.toLowerCase() || '';
  const urls: string[] = [];

  try {
    if (!ianaBootstrapCache || Date.now() - ianaBootstrapCache.fetchedAt > 12 * 60 * 60 * 1000) {
      const res = await fetch('https://data.iana.org/rdap/dns.json', {
        headers: { Accept: 'application/json' },
      });
      if (res.ok) {
        const data: any = await res.json();
        if (Array.isArray(data?.services)) {
          ianaBootstrapCache = { services: data.services, fetchedAt: Date.now() };
        }
      }
    }
    if (ianaBootstrapCache) {
      for (const [tlds, servers] of ianaBootstrapCache.services) {
        if (tlds.some((t) => t.toLowerCase() === tld) && servers.length > 0) {
          const base = servers[0].endsWith('/') ? servers[0] : `${servers[0]}/`;
          urls.push(`${base}domain/${encodeURIComponent(domain)}`);
          break;
        }
      }
    }
  } catch {
    // Fall back to rdap.org aggregator
  }

  urls.push(`https://rdap.org/domain/${encodeURIComponent(domain)}`);
  return urls;
}

function parseVcardEntity(vcardArray: any): {
  fn: string | null;
  org: string | null;
  email: string | null;
  tel: string | null;
  country: string | null;
  state: string | null;
  city: string | null;
} {
  const out = {
    fn: null as string | null,
    org: null as string | null,
    email: null as string | null,
    tel: null as string | null,
    country: null as string | null,
    state: null as string | null,
    city: null as string | null,
  };
  if (!Array.isArray(vcardArray) || !Array.isArray(vcardArray[1])) return out;

  for (const item of vcardArray[1]) {
    if (!Array.isArray(item) || item.length < 4) continue;
    const prop = String(item[0]).toLowerCase();
    const params = item[1] || {};
    const val = item[3];
    if (prop === 'fn' && val && !out.fn) {
      out.fn = String(val).trim() || null;
    } else if (prop === 'org' && val && !out.org) {
      out.org = (Array.isArray(val) ? val.join(' ') : String(val)).trim() || null;
    } else if (prop === 'email' && val && !out.email) {
      out.email = String(val).trim() || null;
    } else if (prop === 'tel' && val && !out.tel) {
      out.tel = String(val).replace(/^tel:/i, '').trim() || null;
    } else if (prop === 'adr') {
      if (params.cc && !out.country) out.country = String(params.cc);
      if (Array.isArray(val)) {
        if (val[3] && !out.city) out.city = String(val[3]).trim() || null;
        if (val[4] && !out.state) out.state = String(val[4]).trim() || null;
        if (val[6] && !out.country) out.country = String(val[6]).trim() || null;
      }
    }
  }
  return out;
}

/**
 * Queries authoritative ICANN/IANA Registry RDAP (RFC 9083) for real domain registration records.
 */
async function queryAuthoritativeRdap(domain: string): Promise<WhoisLookupResult> {
  const candidateUrls = await resolveRdapBaseUrlForDomain(domain);
  let lastError = 'WHOIS / RDAP registry data is unavailable for this domain.';

  for (const url of candidateUrls) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 12000);
    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: {
          Accept: 'application/rdap+json, application/json',
          'User-Agent': 'PulseVanguard-Monitor/1.0 (+https://pulsevanguard.com; whois-rdap)',
        },
        signal: controller.signal,
      });

      if (res.status === 404) {
        throw new Error(`Domain "${domain}" is not registered or no WHOIS record was found in the registry.`);
      }
      if (!res.ok) {
        lastError = `Registry RDAP returned HTTP ${res.status}`;
        continue;
      }

      const data: any = await res.json();
      const events: any[] = Array.isArray(data.events) ? data.events : [];
      const findEvent = (actions: string[]) => {
        const ev = events.find((e) => actions.includes(String(e?.eventAction || '').toLowerCase()));
        return parseIsoDateOrNull(ev?.eventDate);
      };

      const registrationDate = findEvent(['registration', 'registered']);
      const updatedDate = findEvent(['last changed', 'last update of rdap database', 'updated']);
      const expirationDate = findEvent(['expiration', 'registrar expiration']);

      const statusCodes: string[] = Array.isArray(data.status)
        ? data.status.map((s: any) => String(s).trim()).filter(Boolean)
        : [];

      const nameServers: string[] = Array.isArray(data.nameservers)
        ? data.nameservers
            .map((ns: any) => String(ns?.ldhName || ns?.unicodeName || '').trim().toLowerCase())
            .filter(Boolean)
        : [];

      let registrar: string | null = null;
      let registrarIanaId: string | null = null;
      let registrarUrl: string | null = null;
      let abuseContactEmail: string | null = null;
      let abuseContactPhone: string | null = null;
      let registrant: WhoisContactInfo | null = null;
      let adminContact: WhoisContactInfo | null = null;
      let techContact: WhoisContactInfo | null = null;

      const entities: any[] = Array.isArray(data.entities) ? data.entities : [];
      for (const ent of entities) {
        const roles: string[] = Array.isArray(ent?.roles)
          ? ent.roles.map((r: any) => String(r).toLowerCase())
          : [];
        const vcard = parseVcardEntity(ent?.vcardArray);

        if (roles.includes('registrar')) {
          registrar = vcard.fn || vcard.org || ent?.handle || registrar;
          if (Array.isArray(ent?.publicIds)) {
            const ianaObj = ent.publicIds.find((p: any) => /iana/i.test(String(p?.type || '')));
            if (ianaObj?.identifier) registrarIanaId = String(ianaObj.identifier);
          }
          if (!registrarIanaId && ent?.handle && /^\d+$/.test(String(ent.handle))) {
            registrarIanaId = String(ent.handle);
          }
          if (Array.isArray(ent?.links)) {
            const link = ent.links.find((l: any) => l?.href && l?.rel === 'related') || ent.links[0];
            if (link?.href) registrarUrl = String(link.href);
          }
          if (Array.isArray(ent?.entities)) {
            for (const sub of ent.entities) {
              const subRoles: string[] = Array.isArray(sub?.roles)
                ? sub.roles.map((r: any) => String(r).toLowerCase())
                : [];
              if (subRoles.includes('abuse')) {
                const subVcard = parseVcardEntity(sub?.vcardArray);
                abuseContactEmail = subVcard.email || abuseContactEmail;
                abuseContactPhone = subVcard.tel || abuseContactPhone;
              }
            }
          }
        }

        const buildContact = (vc: ReturnType<typeof parseVcardEntity>, remarks: any[]): WhoisContactInfo | null => {
          const remarkText = Array.isArray(remarks)
            ? remarks.map((r) => (Array.isArray(r?.description) ? r.description.join(' ') : r?.title || '')).join(' ')
            : '';
          const redacted =
            isRedactedText(vc.fn) ||
            isRedactedText(vc.org) ||
            isRedactedText(vc.email) ||
            isRedactedText(remarkText);
          if (!vc.org && !vc.fn && !vc.email && !vc.tel && !vc.country && !vc.state && !vc.city && !redacted) {
            return null;
          }
          return {
            organization: vc.org,
            name: vc.fn,
            email: vc.email,
            phone: vc.tel,
            country: vc.country,
            state: vc.state,
            city: vc.city,
            redacted,
          };
        };

        if (roles.includes('registrant') && !registrant) {
          registrant = buildContact(vcard, ent?.remarks);
        }
        if (roles.includes('administrative') && !adminContact) {
          adminContact = buildContact(vcard, ent?.remarks);
        }
        if (roles.includes('technical') && !techContact) {
          techContact = buildContact(vcard, ent?.remarks);
        }
      }

      const notices: string[] = [];
      if (Array.isArray(data.notices)) {
        for (const n of data.notices) {
          if (n?.title) notices.push(String(n.title));
        }
      }
      const privacyRedacted = Boolean(
        registrant?.redacted ||
          adminContact?.redacted ||
          techContact?.redacted ||
          notices.some((n) => /redacted|privacy|gdpr/i.test(n)) ||
          (!registrant && !adminContact && !techContact)
      );

      if (privacyRedacted && !registrant) {
        registrant = {
          organization: null,
          name: 'Redacted for Privacy (GDPR / Registry Policy)',
          email: null,
          phone: null,
          country: null,
          state: null,
          city: null,
          redacted: true,
        };
      }

      const dnssec =
        data.secureDNS?.delegationSigned === true
          ? 'Signed (DNSSEC Enabled)'
          : data.secureDNS?.delegationSigned === false
          ? 'Unsigned'
          : null;

      return {
        domainName: String(data.ldhName || data.unicodeName || domain).toLowerCase(),
        registrar,
        registrarIanaId,
        registrarUrl,
        abuseContactEmail,
        abuseContactPhone,
        registrationDate,
        updatedDate,
        expirationDate,
        daysUntilExpiration: computeDaysUntilExpiration(expirationDate),
        statusCodes: Array.from(new Set(statusCodes)),
        nameServers: Array.from(new Set(nameServers)),
        dnssec,
        registrant,
        adminContact,
        techContact,
        checkedAt: new Date().toISOString(),
        cached: false,
        provider: 'iana-rdap',
        privacyRedacted,
        notices: notices.slice(0, 5),
        providerError: null,
      };
    } catch (err: any) {
      if (/not registered|no WHOIS record/i.test(err?.message || '')) {
        throw err;
      }
      lastError = err?.name === 'AbortError' ? 'Registry lookup timed out.' : (err?.message || lastError);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  throw new Error(lastError);
}

/**
 * Performs a validated, cached WHOIS lookup for a domain name.
 */
export async function performWhoisLookup(
  rawDomain: string,
  options: { forceRefresh?: boolean } = {}
): Promise<WhoisLookupResult> {
  const domain = validateAndNormalizeWhoisDomain(rawDomain);
  await validateTargetSecurity(domain);

  const cached = whoisCache.get(domain);
  if (!options.forceRefresh && cached && Date.now() - cached.timestamp < WHOIS_CACHE_TTL_MS) {
    return {
      ...cached.data,
      cached: true,
    };
  }

  if (!checkWhoisRateLimit()) {
    if (cached) {
      return { ...cached.data, cached: true };
    }
    throw new Error('WHOIS lookup rate limit reached. Please wait a moment before trying again.');
  }

  const config = getWhoisConfig();
  if (config.diagnosticError) {
    throw new Error(config.diagnosticError);
  }

  let result: WhoisLookupResult;
  const apiKey = (process.env.WHOIS_API_KEY || '').trim();

  if (config.hasApiKey && config.provider !== 'iana-rdap') {
    try {
      result = await queryConfiguredApiProvider(domain, config.provider, apiKey);
    } catch (apiErr: any) {
      // If WHOIS_REQUIRE_API_KEY is explicitly true, surface the API provider error directly
      if (config.requireApiKey) {
        throw apiErr;
      }
      // Otherwise fall back to authoritative IANA RDAP and attach a provider diagnostic notice
      result = await queryAuthoritativeRdap(domain);
      result.providerError = redactSecret(apiErr?.message || 'Configured WHOIS API provider returned an error; fell back to authoritative IANA RDAP.', apiKey);
    }
  } else {
    result = await queryAuthoritativeRdap(domain);
  }

  whoisCache.set(domain, {
    data: result,
    timestamp: Date.now(),
  });

  return result;
}
