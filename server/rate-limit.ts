import type { IncomingMessage } from 'node:http';

type Bucket = { count: number; resetAt: number };

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

export function clientIp(req: IncomingMessage): string {
  const address = req.socket.remoteAddress ?? 'unknown';
  return address.startsWith('::ffff:') ? address.slice('::ffff:'.length) : address;
}
