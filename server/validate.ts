import { z } from 'zod';
import { toHalfWidth } from '../src/lib/orderNumber.ts';
import type { CreateOrderInput, RepairStatus } from '../src/types.ts';
import { HttpError } from './errors.ts';

const repairKind = z.enum(['hardware', 'software', 'both']);
const deviceKind = z.enum(['laptop', 'desktop', 'aio', 'display', 'other']);

const createOrderSchema = z.object({
  customer: z.discriminatedUnion('mode', [
    z.object({
      mode: z.literal('existing'),
      id: z.string().trim().min(1).max(80),
    }),
    z.object({
      mode: z.literal('new'),
      name: z.string().trim().min(1).max(80),
      phone: z.string().trim().min(8).max(40),
      email: z.string().trim().max(120).optional(),
      note: z.string().trim().max(500).optional(),
      employeeNumber: z.string().trim().regex(/^\d{6}$/),
      ntAccount: z.string().trim().min(1).max(128),
    }),
  ]),
  device: z.discriminatedUnion('mode', [
    z.object({
      mode: z.literal('existing'),
      id: z.string().trim().min(1).max(80),
    }),
    z.object({
      mode: z.literal('new'),
      kind: deviceKind,
      brand: z.string().trim().min(1).max(80),
      model: z.string().trim().min(1).max(120),
      serialNumber: z.string().trim().max(80).optional(),
      note: z.string().trim().max(500).optional(),
    }),
  ]),
  repairKind,
  repairTarget: z.string().trim().min(1).max(500),
  requirements: z.string().max(2000).optional().default(''),
  initialLog: z.string().max(2000).optional().default(''),
  initialLogVisible: z.boolean().optional().default(false),
});

const statusSchema = z.object({
  status: z.enum(['received', 'in_progress', 'ready', 'completed']),
});

const logSchema = z.object({
  content: z.string().trim().min(1).max(2000),
  visibleToCustomer: z.boolean(),
});

const loginSchema = z.object({
  username: z.string().trim().min(1).max(64),
  password: z.string().min(1).max(200),
});

const searchQuerySchema = z.object({
  number: z.string().max(64).optional().default(''),
  nt: z.string().max(128).optional().default(''),
  from: z.string().max(10).optional().default(''),
  to: z.string().max(10).optional().default(''),
  status: z.enum(['', 'open', 'received', 'in_progress', 'ready', 'completed']).optional().default(''),
  customerId: z.string().max(80).optional().default(''),
  deviceId: z.string().max(80).optional().default(''),
  q: z.string().max(200).optional().default(''),
});

const publicLookupSchema = z.object({
  number: z.string().max(64).optional().default(''),
  phoneLast4: z.string().max(8).optional().default(''),
});

function zodMessage(error: z.ZodError): string {
  const issue = error.issues[0];
  const path = issue?.path.join('.') ?? '';
  if (path.includes('repairKind')) return '維修類型不正確';
  if (path.includes('employeeNumber')) return '公號必須是 6 位數字';
  if (path.includes('ntAccount')) return '請填寫 NT 帳號，例如 CORP\\pinyan';
  if (path.includes('phone')) return '請填寫有效的聯絡電話';
  if (path.includes('repairTarget')) return '請描述送修的硬體或軟體';
  if (path === 'status') return '狀態不正確';
  if (path === 'content') return '請寫下做了什麼事或下了什麼指令';
  if (path === 'username' || path === 'password') return '請輸入帳號與密碼';
  return '內容不正確，請檢查欄位格式與長度';
}

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new HttpError(400, zodMessage(result.error));
  return result.data;
}

function normalizeCreate(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value;
  const body = structuredClone(value) as { customer?: { employeeNumber?: unknown } };
  if (body.customer && typeof body.customer.employeeNumber === 'string') {
    body.customer.employeeNumber = toHalfWidth(body.customer.employeeNumber).trim();
  }
  return body;
}

export function parseCreateOrder(value: unknown): CreateOrderInput {
  const parsed = parse(createOrderSchema, normalizeCreate(value));
  return { ...parsed, author: '' };
}

export function parseStatusBody(value: unknown): { status: RepairStatus } {
  return parse(statusSchema, value);
}

export function parseLogBody(value: unknown): { content: string; visibleToCustomer: boolean } {
  return parse(logSchema, value);
}

export function parseLogin(value: unknown): { username: string; password: string } {
  return parse(loginSchema, value);
}

export function parseSearchQuery(value: Record<string, string>) {
  return parse(searchQuerySchema, value);
}

export function parsePublicLookup(value: Record<string, string>) {
  return parse(publicLookupSchema, value);
}
