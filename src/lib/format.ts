import { DEVICE_KIND_LABEL } from './labels';
import type { Device } from '../types';

export function normalizePhone(value: string): string {
  const halfWidth = value.replace(/[０-９]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0));
  return halfWidth.replace(/\D/g, '');
}

export function normalizeOrderNumber(value: string): string {
  return value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function formatPhone(phone: string): string {
  const digits = normalizePhone(phone);
  if (digits.length === 10) {
    return `${digits.slice(0, 4)}-${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  return phone.trim();
}

export function maskPhone(phone: string): string {
  const digits = normalizePhone(phone);
  if (digits.length >= 8) {
    return `${digits.slice(0, 4)}-***-${digits.slice(-3)}`;
  }
  return '已留存';
}

export function maskSerial(serial?: string): string | undefined {
  if (!serial) return undefined;
  if (serial.length <= 4) return serial;
  return serial.slice(-4);
}

export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat('zh-TW', {
    timeZone: 'Asia/Taipei',
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function formatLongDate(date: Date): string {
  return new Intl.DateTimeFormat('zh-TW', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  }).format(date);
}

export function deviceLabel(device: Device): string {
  return `${DEVICE_KIND_LABEL[device.kind]} · ${device.brand} ${device.model}`;
}

export function deviceKindSummary(devices: Device[]): string {
  const counts = new Map<Device['kind'], number>();
  for (const device of devices) {
    counts.set(device.kind, (counts.get(device.kind) ?? 0) + 1);
  }
  return (Object.keys(DEVICE_KIND_LABEL) as Device['kind'][])
    .filter((kind) => (counts.get(kind) ?? 0) > 0)
    .map((kind) => `${DEVICE_KIND_LABEL[kind]} ${counts.get(kind)}`)
    .join('、');
}
