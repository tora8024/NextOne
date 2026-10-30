import type { IncomingMessage } from 'node:http';
import { isIP } from 'node:net';

type Bucket = { count: number; resetAt: number };
type Lock = { failures: number; lockedUntil: number };

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

export function createRateLimiter(options: { limit: () => number; windowMs: () => number }) {
  const buckets = new Map<string, Bucket>();
  return {
    allow(key: string, now = Date.now()): boolean {
      const limit = options.limit();
      const windowMs = options.windowMs();
      const current = buckets.get(key);
      if (!current || now >= current.resetAt) {
        buckets.set(key, { count: 1, resetAt: now + windowMs });
        return true;
      }
      if (current.count >= limit) return false;
      current.count += 1;
      return true;
    },
    reset() {
      buckets.clear();
    },
  };
}

export function createLockout(options: { limit: () => number; lockMs: () => number }) {
  const locks = new Map<string, Lock>();
  return {
    isLocked(key: string, now = Date.now()): boolean {
      const current = locks.get(key);
      if (!current?.lockedUntil) return false;
      if (current.lockedUntil > now) return true;
      locks.delete(key);
      return false;
    },
    fail(key: string, now = Date.now()): boolean {
      const current = locks.get(key);
      if (current && current.lockedUntil > now) return true;
      const expired = Boolean(current && current.lockedUntil > 0 && current.lockedUntil <= now);
      const failures = (expired ? 0 : (current?.failures ?? 0)) + 1;
      if (failures >= options.limit()) {
        locks.set(key, { failures: 0, lockedUntil: now + options.lockMs() });
        return true;
      }
      locks.set(key, { failures, lockedUntil: 0 });
      return false;
    },
    succeed(key: string) {
      locks.delete(key);
    },
    reset() {
      locks.clear();
    },
  };
}

export const generalLimiter = createRateLimiter({
  limit: () => intEnv('REPAIR_RATE_LIMIT', 120),
  windowMs: () => intEnv('REPAIR_RATE_WINDOW_MS', 60_000),
});

export const lookupLimiter = createRateLimiter({
  limit: () => intEnv('REPAIR_LOOKUP_LIMIT', 20),
  windowMs: () => intEnv('REPAIR_LOOKUP_WINDOW_MS', 60_000),
});

export const loginLimiter = createRateLimiter({
  limit: () => intEnv('REPAIR_LOGIN_LIMIT', 10),
  windowMs: () => intEnv('REPAIR_LOGIN_WINDOW_MS', 10 * 60_000),
});

export const loginLockout = createLockout({
  limit: () => intEnv('REPAIR_LOGIN_LOCKOUT_LIMIT', 5),
  lockMs: () => intEnv('REPAIR_LOGIN_LOCKOUT_MS', 15 * 60_000),
});

export const lookupLockout = createLockout({
  limit: () => intEnv('REPAIR_LOOKUP_LOCKOUT_LIMIT', 5),
  lockMs: () => intEnv('REPAIR_LOOKUP_LOCKOUT_MS', 15 * 60_000),
});

function padHextet(part: string): string {
  return part.padStart(4, '0');
}

function expandIPv6(ip: string): string | null {
  const lower = ip.toLowerCase();
  const halves = lower.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 ? (halves[1] ? halves[1].split(':') : []) : [];
  if (halves.length === 1) {
    if (head.length !== 8) return null;
    return head.map(padHextet).join(':');
  }
  const missing = 8 - head.length - tail.length;
  if (missing < 1) return null;
  return [...head, ...Array.from({ length: missing }, () => '0'), ...tail].map(padHextet).join(':');
}

/** Full IPv6, or dotted IPv4. IPv4-mapped IPv6 becomes IPv4. */
export function normalizeIp(value: string): string | null {
  let token = value.trim().toLowerCase();
  if (!token || token === 'unknown') return null;
  const zone = token.indexOf('%');
  if (zone !== -1) token = token.slice(0, zone);
  if (token.startsWith('[') && token.endsWith(']')) token = token.slice(1, -1);
  if (token.startsWith('::ffff:')) {
    const mapped = token.slice('::ffff:'.length);
    if (isIP(mapped) === 4) return mapped;
  }
  if (isIP(token) === 4) return token;
  if (isIP(token) === 6) return expandIPv6(token);
  return null;
}

/** IPv4 stays as-is. IPv6 rate-limit keys share a /64. */
export function bucketIp(value: string): string {
  const normalized = normalizeIp(value);
  if (!normalized) return value.trim() || 'unknown';
  if (isIP(normalized) === 4) return normalized;
  const hextets = normalized.split(':');
  return `${hextets.slice(0, 4).join(':')}::/64`;
}

function trustedProxies(): Set<string> {
  const trusted = new Set<string>();
  for (const part of (process.env.REPAIR_TRUSTED_PROXIES ?? '').split(',')) {
    const normalized = normalizeIp(part);
    if (normalized) trusted.add(normalized);
  }
  return trusted;
}

function headerValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value.join(',');
  return value ?? '';
}

function clientFromForwarded(header: string, trusted: Set<string>): string | null {
  const hops = header
    .split(',')
    .map((part) => normalizeIp(part))
    .filter((part): part is string => part != null);
  for (let index = hops.length - 1; index >= 0; index -= 1) {
    const hop = hops[index];
    if (hop && !trusted.has(hop)) return hop;
  }
  return null;
}

export function clientIp(req: IncomingMessage): string {
  const peer = normalizeIp(req.socket.remoteAddress ?? '') ?? 'unknown';
  const trusted = trustedProxies();
  if (peer !== 'unknown' && trusted.has(peer)) {
    const forwarded = clientFromForwarded(headerValue(req.headers['x-forwarded-for']), trusted);
    if (forwarded) return bucketIp(forwarded);
  }
  return peer === 'unknown' ? 'unknown' : bucketIp(peer);
}

export function lockoutKey(value: string): string {
  return value.trim().toLowerCase();
}
