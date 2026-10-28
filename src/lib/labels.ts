import type { DeviceKind, RepairKind, RepairStatus } from '../types';

export const STATUS_ORDER: RepairStatus[] = ['received', 'in_progress', 'ready', 'completed'];

export const STATUS_LABEL: Record<RepairStatus, string> = {
  received: '已受理',
  in_progress: '維修中',
  ready: '待取件',
  completed: '已完成',
};

export const STATUS_HINT: Record<RepairStatus, string> = {
  received: '我們已收到設備，即將開始檢測。',
  in_progress: '技術人員正在維修，完成後會更新狀態。',
  ready: '維修已完成，請於營業時間到店取件。',
  completed: '這張維修單已結案。',
};

export const REPAIR_KINDS: RepairKind[] = ['hardware', 'software', 'both'];

export const REPAIR_KIND_LABEL: Record<RepairKind, string> = {
  hardware: '硬體',
  software: '軟體',
  both: '硬體與軟體',
};

export const DEVICE_KINDS: DeviceKind[] = ['laptop', 'desktop', 'aio', 'display', 'other'];

export const DEVICE_KIND_LABEL: Record<DeviceKind, string> = {
  laptop: '筆記型電腦',
  desktop: '桌上型電腦',
  aio: '一體機',
  display: '螢幕',
  other: '其他',
};

export function isRepairStatus(value: string): value is RepairStatus {
  return (STATUS_ORDER as readonly string[]).includes(value);
}

export function isRepairKind(value: string): value is RepairKind {
  return (REPAIR_KINDS as readonly string[]).includes(value);
}

export function isDeviceKind(value: string): value is DeviceKind {
  return (DEVICE_KINDS as readonly string[]).includes(value);
}
