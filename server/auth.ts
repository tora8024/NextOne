import { createHash, randomBytes } from 'node:crypto';
import type { DatabaseSync, SQLOutputValue } from 'node:sqlite';
import type { SessionUser } from '../src/types.ts';
import { HttpError } from './errors.ts';
import { DUMMY_PASSWORD_HASH, hashPassword, verifyPassword } from './password.ts';

type Row = Record<string, SQLOutputValue>;

const SESSION_SECONDS = 8 * 60 * 60;

export function sessionCookieName(): string {
  return process.env.NODE_ENV === 'production' ? '__Host-nextone_session' : 'nextone_session';
}

export function authenticate(db: DatabaseSync, username: string, password: string): SessionUser | null {
  const row = db.prepare('SELECT username, password_hash, role, must_change_password FROM users WHERE username = ?').get(username) as
    | Row
    | undefined;
  const hash = row ? text(row, 'password_hash') : DUMMY_PASSWORD_HASH;
  const matches = verifyPassword(password, hash);
  if (!row || !matches) return null;
  const role = text(row, 'role');
  if (role !== 'admin' && role !== 'staff') return null;
  return { username: text(row, 'username'), role, mustChangePassword: flag(row, 'must_change_password') };
}

export function changePassword(db: DatabaseSync, username: string, currentPassword: string, newPassword: string): SessionUser {
  const user = authenticate(db, username, currentPassword);
  if (!user) throw new HttpError(401, '目前密碼不正確');
  if (newPassword === currentPassword) throw new HttpError(400, '新密碼不能與目前密碼相同');
  db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE username = ?').run(hashPassword(newPassword), username);
  return { ...user, mustChangePassword: false };
}

export function purgeExpiredSessions(db: DatabaseSync, now = new Date()) {
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now.toISOString());
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
      `SELECT u.username AS username, u.role AS role, u.must_change_password AS must_change_password, s.expires_at AS expires_at
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
  return { username: text(row, 'username'), role, mustChangePassword: flag(row, 'must_change_password') };
}

export function destroySession(db: DatabaseSync, token: string | undefined) {
  if (!token) return;
  const tokenHash = createHash('sha256').update(token).digest('hex');
  db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
}

function cookieAttributes(): string {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `HttpOnly; SameSite=Strict; Path=/${secure}`;
}

export function sessionCookie(token: string, maxAge: number): string {
  return `${sessionCookieName()}=${encodeURIComponent(token)}; ${cookieAttributes()}; Max-Age=${maxAge}`;
}

export function clearSessionCookie(): string {
  return `${sessionCookieName()}=; ${cookieAttributes()}; Max-Age=0`;
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

function flag(row: Row, key: string): boolean {
  const value = row[key];
  if (typeof value === 'number') return value === 1;
  if (typeof value === 'bigint') return value === 1n;
  return false;
}
