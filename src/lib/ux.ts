export const PASSWORD_RULE = '8 到 200 個字，不能與目前密碼相同';
export const INITIAL_PASSWORD_HINT = '第一次登入時，目前密碼是初始密碼。';
export const LOOKUP_NUMBER_HELP = '單號印在送修單上';
export const LOOKUP_PHONE_PLACEHOLDER = '例：1234';
export const SERIAL_HINT = '流水號要 3 位，例如 001';
export const PASSWORD_UPDATED = '密碼已更新。其他視窗已登出';
export const RESET_CONFIRM = '還原示範資料';
export const PUBLIC_RECORDER = '門市';

export function showDemoAndReset(production: boolean): boolean {
  return !production;
}

export function loginLockoutMessage(seconds: number): string {
  const wait = Math.max(1, Math.ceil(seconds));
  return `登入失敗次數過多，請約 ${wait} 秒後再試。請聯絡系統管理員。`;
}

export function lookupLockoutMessage(seconds: number, phone = ''): string {
  const wait = Math.max(1, Math.ceil(seconds));
  const trimmed = phone.trim();
  const contact = trimmed ? `請聯絡門市人員 ${trimmed}` : '請聯絡門市人員';
  return `這個單號查詢次數過多，請約 ${wait} 秒後再試。${contact}。`;
}

export function attemptsRemainingWarning(remaining: number, lockMs: number): string | null {
  if (remaining !== 1 && remaining !== 2) return null;
  const minutes = Math.max(1, Math.round(lockMs / 60_000));
  return `再錯 ${remaining} 次會鎖定 ${minutes} 分鐘`;
}

export function countdownSeconds(total: number, startedAt: number, now: number): number {
  if (!Number.isFinite(total) || total <= 0) return 0;
  return Math.max(0, total - Math.floor((now - startedAt) / 1000));
}

export function statusConfirmText(label: string): string {
  return `確定要把狀態改成「${label}」嗎？`;
}
