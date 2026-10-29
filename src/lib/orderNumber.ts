export function toHalfWidth(value: string): string {
  return value.replace(/[０-９]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0));
}

export function taipeiCalendar(date: Date): { compact: string; ymd: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const year = parts.find((part) => part.type === 'year')?.value ?? '0000';
  const month = parts.find((part) => part.type === 'month')?.value ?? '01';
  const day = parts.find((part) => part.type === 'day')?.value ?? '01';
  return { compact: `${year}${month}${day}`, ymd: `${year}-${month}-${day}` };
}

export function formatOrderSerial(serial: number): string {
  if (!Number.isInteger(serial) || serial < 1) throw new Error('流水號必須是正整數');
  return serial < 1000 ? String(serial).padStart(3, '0') : String(serial);
}

export function formatOrderNumber(orderDate: string, serial: number): string {
  if (!/^\d{8}$/.test(orderDate)) throw new Error('單號日期不正確');
  return `WO-${orderDate}-${formatOrderSerial(serial)}`;
}

export function isEmployeeNumber(value: string): boolean {
  return /^\d{6}$/.test(value);
}

const NT_PART = /^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$/;

export function isNtAccount(value: string): boolean {
  const parts = value.trim().split(/[\\/]/).filter((part) => part.length > 0);
  if (parts.length < 1 || parts.length > 2) return false;
  return parts.every((part) => NT_PART.test(part));
}

export function ntSam(value: string): string {
  const parts = value.trim().split(/[\\/]/).filter((part) => part.length > 0);
  return (parts.at(-1) ?? '').toLowerCase();
}

export function parseFullOrderNumber(value: string): { orderDate: string; serial: number } | null {
  const normalized = toHalfWidth(value).trim();
  const match = /^wo-(\d{8})-(\d+)$/i.exec(normalized);
  if (!match?.[1] || !match[2]) return null;
  const serial = Number(match[2]);
  if (!Number.isInteger(serial) || serial < 1) return null;
  return { orderDate: match[1], serial };
}

export function parseSerialToken(value: string): number | null {
  const normalized = toHalfWidth(value).trim();
  if (!/^\d+$/.test(normalized) || normalized.length > 9) return null;
  const serial = Number(normalized);
  if (!Number.isSafeInteger(serial) || serial < 1) return null;
  return serial;
}
