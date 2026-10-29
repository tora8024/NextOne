import { createHash, randomBytes } from 'node:crypto';
import type { DatabaseSync, SQLOutputValue } from 'node:sqlite';
import type { SessionUser } from '../src/types.ts';
import { DUMMY_PASSWORD_HASH, verifyPassword } from './password.ts';

type Row = Record<string, SQLOutputValue>;

export const SESSION_COOKIE = 'nextone_session';
const SESSION_SECONDS = 8 * 60 * 60;

export function authenticate(db: DatabaseSync, username: string, password: string): SessionUser | null {
  const row = db.prepare('SELECT username, password_hash, role FROM users WHERE username = ?').get(username) as Row | undefined;
  const hash = row ? text(row, 'password_hash') : DUMMY_PASSWORD_HASH;
  const matches = verifyPassword(password, hash);
  if (!row || !matches) return null;
  const role = text(row, 'role');
  if (role !== 'admin' && role !== 'staff') return null;
  return { username: text(row, 'username'), role };
}

export function createSession(db: DatabaseSync, username: string): { token: string; maxAge: number } {
  const user = db.prepare('SELECT id FROM users WHERE username = ?').get(username) as Row | undefined;
  if (!user) throw new Error('找不到使用者');
  const token = randomBytes(32).toString('base64url');
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const now = new Date();
  const expires = new Date(now.getTime() + SESSION_SECONDS * 1000);
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)').run(
    tokenHash,
    text(user, 'id'),
    expires.toISOString(),
    now.toISOString(),
  );
  return { token, maxAge: SESSION_SECONDS };
}

export function readSession(db: DatabaseSync, token: string | undefined): SessionUser | null {
  if (!token || token.length > 200) return null;
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const row = db
    .prepare(
      `SELECT u.username AS username, u.role AS role, s.expires_at AS expires_at
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ?`,
    )
    .get(tokenHash) as Row | undefined;
  if (!row) return null;
  if (Date.parse(text(row, 'expires_at')) <= Date.now()) {
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
    return null;
  }
  const role = text(row, 'role');
  if (role !== 'admin' && role !== 'staff') return null;
  return { username: text(row, 'username'), role };
}

export function destroySession(db: DatabaseSync, token: string | undefined) {
  if (!token) return;
  const tokenHash = createHash('sha256').update(token).digest('hex');
  db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
}

export function sessionCookie(token: string, maxAge: number): string {
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}`;
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`;
}

export function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(separator + 1).trim());
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function text(row: Row, key: string): string {
  const value = row[key];
  if (typeof value !== 'string') throw new Error(`欄位 ${key} 不是文字`);
  return value;
}
