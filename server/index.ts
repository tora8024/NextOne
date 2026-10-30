import fs from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalWorkOrderNumber } from '../src/lib/orderNumber.ts';
import { attemptsRemainingWarning, loginLockoutMessage, lookupLockoutMessage } from '../src/lib/ux.ts';
import type { SessionUser } from '../src/types.ts';
import {
  authenticate,
  changePassword,
  clearSessionCookie,
  createSession,
  destroySession,
  purgeExpiredSessions,
  readCookie,
  readSession,
  sessionCookie,
  sessionCookieName,
} from './auth.ts';
import { addLog, createOrder, deleteInitialPasswordFile, ensureSeeded, getState, openDatabase, resetSeed, restrictOpenDatabase, searchOrders, searchPublic, updateStatus } from './db.ts';
import { HttpError } from './errors.ts';
import { databasePath } from './paths.ts';
import { clientIp, generalLimiter, loginAccountLockout, loginLimiter, loginLockout, lookupLimiter, lookupLockout, purgeLimitMaps } from './rate-limit.ts';
import { parseCreateOrder, parseLogBody, parseLogin, parsePasswordChange, parsePublicLookup, parseSearchQuery, parseStatusBody } from './validate.ts';

const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'no-store',
};

const BIND_HOST = '127.0.0.1';

export type RunningServer = {
  port: number;
  host: string;
  close: () => Promise<void>;
};

export function startServer(options?: { port?: number; filename?: string }): Promise<RunningServer> {
  const filename = options?.filename ?? databasePath();
  const database = openDatabase(filename);
  ensureSeeded(database);
  restrictOpenDatabase(database);
  purgeExpiredSessions(database);
  purgeLimitMaps();
  const purgeTimer = setInterval(() => {
    try {
      purgeExpiredSessions(database);
    } catch {
      // The database may already be closed.
    }
    purgeLimitMaps();
  }, 15 * 60 * 1000);
  purgeTimer.unref();

  const server = createServer((req, res) => {
    void handle(req, res);
  });

  async function handle(req: IncomingMessage, res: ServerResponse) {
    try {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      const ip = clientIp(req);
      if (!generalLimiter.allow(ip)) {
        const retryAfter = generalLimiter.retryAfter(ip);
        throw new HttpError(429, `請求次數過多，請約 ${retryAfter} 秒後再試。`, retryAfter);
      }
      if (req.method === 'OPTIONS') {
        if (!originAllowed(req)) {
          send(req, res, 403, { error: '來源不被允許' });
          return;
        }
        send(req, res, 204, null);
        return;
      }
      assertMutatingOrigin(req);
      if (req.method === 'GET' && url.pathname === '/api/health') {
        send(req, res, 200, { ok: true });
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/login') {
        if (loginLimiter.isLimited(ip)) {
          const retryAfter = loginLimiter.retryAfter(ip);
          throw new HttpError(429, loginLockoutMessage(retryAfter), retryAfter);
        }
        assertJson(req);
        const body = parseLogin(await readJson(req));
        const username = body.username.trim().toLowerCase();
        const account = `${username}|${ip}`;
        if (loginLockout.isLocked(account) || loginAccountLockout.isLocked(username)) {
          const retryAfter = Math.max(loginLockout.retryAfter(account), loginAccountLockout.retryAfter(username));
          authenticate(database, body.username, body.password);
          throw new HttpError(429, loginLockoutMessage(retryAfter), retryAfter);
        }
        const user = authenticate(database, body.username, body.password);
        if (!user) {
          loginLimiter.record(ip);
          loginLockout.fail(account);
          loginAccountLockout.fail(username);
          const remainingAttempts = Math.min(loginLockout.remaining(account), loginAccountLockout.remaining(username));
          const lockMs = Number(process.env.REPAIR_LOGIN_LOCKOUT_MS ?? 15 * 60_000);
          const warning = attemptsRemainingWarning(remainingAttempts, Number.isFinite(lockMs) && lockMs > 0 ? lockMs : 15 * 60_000);
          const message = warning ? `帳號或密碼不正確。${warning}` : '帳號或密碼不正確';
          throw new HttpError(401, message, undefined, remainingAttempts);
        }
        loginLockout.succeed(account);
        loginAccountLockout.succeed(username);
        const session = createSession(database, user.username);
        send(req, res, 200, user, { 'Set-Cookie': sessionCookie(session.token, session.maxAge) });
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/logout') {
        destroySession(database, readCookie(req.headers.cookie, sessionCookieName()));
        send(req, res, 200, { ok: true }, { 'Set-Cookie': clearSessionCookie() });
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/me') {
        send(req, res, 200, requireUser(req, true));
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/account/password') {
        const user = requireUser(req, true);
        assertJson(req);
        const body = parsePasswordChange(await readJson(req));
        const updated = changePassword(database, user.username, body.currentPassword, body.newPassword);
        deleteInitialPasswordFile(database);
        const session = createSession(database, updated.username);
        send(req, res, 200, updated, { 'Set-Cookie': sessionCookie(session.token, session.maxAge) });
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/lookup') {
        if (!lookupLimiter.allow(ip)) {
          const retryAfter = lookupLimiter.retryAfter(ip);
          throw new HttpError(429, lookupLockoutMessage(retryAfter, storePhone()), retryAfter);
        }
        const query = parsePublicLookup({
          number: url.searchParams.get('number') ?? '',
          phoneLast4: url.searchParams.get('phoneLast4') ?? '',
        });
        const orderNumber = canonicalWorkOrderNumber(query.number);
        const orderKey = orderNumber ? `${orderNumber}|${ip}` : null;
        if (orderKey && lookupLockout.isLocked(orderKey)) {
          const retryAfter = lookupLockout.retryAfter(orderKey);
          throw new HttpError(429, lookupLockoutMessage(retryAfter, storePhone()), retryAfter);
        }
        let orders;
        try {
          orders = searchPublic(database, query);
        } catch (error) {
          if (orderKey) lookupLockout.fail(orderKey);
          throw error;
        }
        if (orderKey) {
          if (orders.length === 0) lookupLockout.fail(orderKey);
          else lookupLockout.succeed(orderKey);
        }
        send(req, res, 200, { orders });
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/state') {
        requireUser(req);
        send(req, res, 200, getState(database));
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/orders/search') {
        requireUser(req);
        const filters = parseSearchQuery({
          number: url.searchParams.get('number') ?? '',
          nt: url.searchParams.get('nt') ?? '',
          from: url.searchParams.get('from') ?? '',
          to: url.searchParams.get('to') ?? '',
          status: url.searchParams.get('status') ?? '',
          customerId: url.searchParams.get('customerId') ?? '',
          deviceId: url.searchParams.get('deviceId') ?? '',
          q: url.searchParams.get('q') ?? '',
        });
        send(req, res, 200, { orders: searchOrders(database, filters) });
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/orders') {
        const user = requireUser(req);
        assertJson(req);
        const input = parseCreateOrder(await readJson(req));
        input.author = user.username;
        const order = createOrder(database, input);
        send(req, res, 201, { order });
        return;
      }
      const statusMatch = /^\/api\/orders\/([^/]+)\/status$/.exec(url.pathname);
      if (req.method === 'POST' && statusMatch?.[1]) {
        const user = requireUser(req);
        assertJson(req);
        const body = parseStatusBody(await readJson(req));
        updateStatus(database, orderIdFromPath(statusMatch[1]), body.status, user.username);
        send(req, res, 200, { ok: true });
        return;
      }
      const logMatch = /^\/api\/orders\/([^/]+)\/logs$/.exec(url.pathname);
      if (req.method === 'POST' && logMatch?.[1]) {
        const user = requireUser(req);
        assertJson(req);
        const body = parseLogBody(await readJson(req));
        addLog(database, orderIdFromPath(logMatch[1]), {
          author: user.username,
          content: body.content,
          visibleToCustomer: body.visibleToCustomer,
        });
        send(req, res, 201, { ok: true });
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/admin/reset') {
        const user = requireUser(req);
        if (user.role !== 'admin') throw new HttpError(403, '只有管理員可以還原示範資料');
        if (process.env.NODE_ENV === 'production') throw new HttpError(403, '正式環境已停用還原示範資料');
        resetSeed(database);
        restrictOpenDatabase(database);
        send(req, res, 200, getState(database));
        return;
      }
      send(req, res, 404, { error: '找不到這個 API' });
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      const message = error instanceof Error ? error.message : '伺服器錯誤';
      const retryAfter = error instanceof HttpError ? error.retryAfter : undefined;
      const remainingAttempts = error instanceof HttpError ? error.remainingAttempts : undefined;
      if (status === 500) console.error(error);
      if (!res.headersSent) {
        const payload: { error: string; retryAfterSeconds?: number; remainingAttempts?: number } = {
          error: status === 500 ? '伺服器錯誤' : message,
        };
        if (retryAfter) payload.retryAfterSeconds = retryAfter;
        if (remainingAttempts !== undefined) payload.remainingAttempts = remainingAttempts;
        send(req, res, status, payload, retryAfter ? { 'Retry-After': String(retryAfter) } : undefined);
      }
    }
  }

  function requireUser(req: IncomingMessage, allowDuringPasswordChange = false): SessionUser {
    const user = readSession(database, readCookie(req.headers.cookie, sessionCookieName()));
    if (!user) throw new HttpError(401, '請先登入');
    if (user.mustChangePassword && !allowDuringPasswordChange) throw new HttpError(403, '請先變更密碼');
    return user;
  }

  const port = options?.port ?? Number(process.env.PORT ?? 8787);
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => {
      clearInterval(purgeTimer);
      database.close();
      reject(error);
    };
    server.once('error', onError);
    server.listen(port, BIND_HOST, () => {
      server.off('error', onError);
      const address = server.address();
      if (!address || typeof address !== 'object' || address.address !== BIND_HOST) {
        clearInterval(purgeTimer);
        server.close();
        database.close();
        reject(new Error('API 只能綁定 127.0.0.1'));
        return;
      }
      const boundPort = address.port;
      resolve({
        port: boundPort,
        host: address.address,
        close: () =>
          new Promise((done, fail) => {
            clearInterval(purgeTimer);
            server.close((error) => {
              database.close();
              if (error) fail(error);
              else done();
            });
          }),
      });
    });
  });
}

function storePhone(): string {
  return (process.env.REPAIR_STORE_PHONE ?? '').trim();
}

function orderIdFromPath(raw: string): string {
  let id = raw;
  try {
    id = decodeURIComponent(raw);
  } catch {
    throw new HttpError(400, '維修單編號不正確');
  }
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(id)) throw new HttpError(400, '維修單編號不正確');
  return id;
}

function allowedOrigins(): Set<string> {
  const origins = new Set<string>();
  const ports = new Set([5173, 4173, 8787, Number(process.env.PORT ?? 8787)]);
  for (const host of ['localhost', '127.0.0.1']) {
    for (const port of ports) {
      if (Number.isFinite(port) && port > 0) origins.add(`http://${host}:${port}`);
    }
  }
  for (const extra of (process.env.REPAIR_ALLOWED_ORIGINS ?? '').split(',')) {
    const trimmed = extra.trim();
    if (trimmed) origins.add(trimmed);
  }
  return origins;
}

function headerOne(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}

function originAllowed(req: IncomingMessage): boolean {
  const origin = headerOne(req.headers.origin);
  if (!origin) return true;
  return allowedOrigins().has(origin);
}

function assertMutatingOrigin(req: IncomingMessage) {
  const method = req.method ?? 'GET';
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return;
  const allowed = allowedOrigins();
  const origin = headerOne(req.headers.origin);
  if (origin) {
    if (!allowed.has(origin)) throw new HttpError(403, '來源不被允許');
    return;
  }
  const referer = headerOne(req.headers.referer);
  if (!referer) return;
  try {
    const refererOrigin = new URL(referer).origin;
    if (!allowed.has(refererOrigin)) throw new HttpError(403, '來源不被允許');
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(403, '來源不被允許');
  }
}

function assertJson(req: IncomingMessage) {
  const type = headerOne(req.headers['content-type']);
  if (type && !type.toLowerCase().startsWith('application/json')) throw new HttpError(415, '請使用 JSON');
}

function corsHeaders(req: IncomingMessage): Record<string, string> {
  const origin = headerOne(req.headers.origin);
  if (!origin || !allowedOrigins().has(origin)) return { Vary: 'Origin' };
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    Vary: 'Origin',
  };
}

function send(
  req: IncomingMessage,
  res: ServerResponse,
  status: number,
  body: unknown,
  extra?: Record<string, string>,
) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    ...SECURITY_HEADERS,
    ...corsHeaders(req),
    ...extra,
  });
  res.end(body == null ? '' : JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
    size += buffer.length;
    if (size > 1_000_000) throw new HttpError(413, '內容過大');
    chunks.push(buffer);
  }
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch {
    throw new HttpError(400, 'JSON 格式不正確');
  }
}

function isDirectRun(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return fs.realpathSync(path.resolve(entry)) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isDirectRun()) {
  startServer()
    .then((running) => {
      console.log(`維修資料庫 API http://${running.host}:${running.port}`);
    })
    .catch((error: unknown) => {
      console.error(error);
      process.exit(1);
    });
}
