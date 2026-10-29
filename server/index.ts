import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { CreateOrderInput, RepairStatus } from '../src/types.ts';
import { addLog, createOrder, ensureSeeded, getState, openDatabase, resetSeed, searchOrders, searchPublic, updateStatus } from './db.ts';
import { HttpError } from './errors.ts';
import { databasePath } from './paths.ts';

const database = openDatabase(databasePath());
ensureSeeded(database);

const server = createServer((req, res) => {
  void handle(req, res);
});

async function handle(req: IncomingMessage, res: ServerResponse) {
  try {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (req.method === 'OPTIONS') {
      send(res, 204, null);
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/health') {
      send(res, 200, { ok: true });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/state') {
      send(res, 200, getState(database));
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/orders/search') {
      send(res, 200, { orders: searchOrders(database, readFilters(url)) });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/lookup') {
      send(res, 200, { orders: searchPublic(database, readFilters(url)) });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/orders') {
      const order = createOrder(database, asCreateInput(await readJson(req)));
      send(res, 201, { order });
      return;
    }
    const statusMatch = /^\/api\/orders\/([^/]+)\/status$/.exec(url.pathname);
    if (req.method === 'POST' && statusMatch?.[1]) {
      const body = (await readJson(req)) as { status?: RepairStatus; author?: string };
      if (!body.status) throw new HttpError(400, '請提供狀態');
      updateStatus(database, decodeURIComponent(statusMatch[1]), body.status, body.author ?? '');
      send(res, 200, { ok: true });
      return;
    }
    const logMatch = /^\/api\/orders\/([^/]+)\/logs$/.exec(url.pathname);
    if (req.method === 'POST' && logMatch?.[1]) {
      const body = (await readJson(req)) as { author?: string; content?: string; visibleToCustomer?: boolean };
      addLog(database, decodeURIComponent(logMatch[1]), {
        author: body.author ?? '',
        content: body.content ?? '',
        visibleToCustomer: Boolean(body.visibleToCustomer),
      });
      send(res, 201, { ok: true });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/admin/reset') {
      resetSeed(database);
      send(res, 200, getState(database));
      return;
    }
    send(res, 404, { error: '找不到這個 API' });
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    const message = error instanceof Error ? error.message : '伺服器錯誤';
    if (status === 500) console.error(error);
    send(res, status, { error: status === 500 ? '伺服器錯誤' : message });
  }
}

function readFilters(url: URL) {
  return {
    number: url.searchParams.get('number') ?? '',
    nt: url.searchParams.get('nt') ?? '',
    from: url.searchParams.get('from') ?? '',
    to: url.searchParams.get('to') ?? '',
    status: url.searchParams.get('status') ?? '',
    customerId: url.searchParams.get('customerId') ?? '',
    deviceId: url.searchParams.get('deviceId') ?? '',
    q: url.searchParams.get('q') ?? '',
  };
}

function asCreateInput(value: unknown): CreateOrderInput {
  if (!value || typeof value !== 'object') throw new HttpError(400, '內容不正確');
  const body = value as Partial<CreateOrderInput>;
  if (!body.customer || !body.device || !body.repairKind || !body.repairTarget) {
    throw new HttpError(400, '維修單內容不完整');
  }
  return body as CreateOrderInput;
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'no-store',
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

const port = Number(process.env.PORT ?? 8787);
server.listen(port, '0.0.0.0', () => {
  console.log(`維修資料庫 API http://127.0.0.1:${port}`);
});
