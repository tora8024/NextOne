export type RepairStatus = 'received' | 'in_progress' | 'ready' | 'completed';

export type RepairKind = 'hardware' | 'software' | 'both';

export type DeviceKind = 'laptop' | 'desktop' | 'aio' | 'display' | 'other';

export type LogKind = 'status' | 'note';

export type Customer = {
  id: string;
  name: string;
  phone: string;
  email?: string;
  note?: string;
  createdAt: string;
};

export type Device = {
  id: string;
  customerId: string;
  kind: DeviceKind;
  brand: string;
  model: string;
  serialNumber?: string;
  note?: string;
  createdAt: string;
};

export type ActionLog = {
  id: string;
  at: string;
  author: string;
  content: string;
  visibleToCustomer: boolean;
  kind: LogKind;
};

export type RepairOrder = {
  id: string;
  orderNumber: string;
  customerId: string;
  deviceId: string;
  repairKind: RepairKind;
  repairTarget: string;
  requirements: string;
  status: RepairStatus;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  logs: ActionLog[];
};

export type Database = {
  version: 1;
  customers: Customer[];
  devices: Device[];
  orders: RepairOrder[];
};

export type CreateOrderInput = {
  customer:
    | { mode: 'existing'; id: string }
    | { mode: 'new'; name: string; phone: string; email?: string; note?: string };
  device:
    | { mode: 'existing'; id: string }
    | {
        mode: 'new';
        kind: DeviceKind;
        brand: string;
        model: string;
        serialNumber?: string;
        note?: string;
      };
  repairKind: RepairKind;
  repairTarget: string;
  requirements: string;
  initialLog: string;
  initialLogVisible: boolean;
  author: string;
};
