export type RepairStatus = 'received' | 'in_progress' | 'ready' | 'completed';

export type RepairKind = 'hardware' | 'software' | 'both';

export type DeviceKind = 'laptop' | 'desktop' | 'aio' | 'display' | 'other';

export type LogKind = 'status' | 'note';

export type MatchReason = 'employee_number' | 'order_serial' | 'order_number' | 'nt_account';

export type Customer = {
  id: string;
  name: string;
  phone: string;
  email?: string;
  note?: string;
  employeeNumber: string;
  ntAccount: string;
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

export type StatusChange = {
  id: string;
  at: string;
  author: string;
  fromStatus: RepairStatus | null;
  toStatus: RepairStatus;
};

export type RepairOrder = {
  id: string;
  orderDate: string;
  serial: number;
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
  statusHistory?: StatusChange[];
  matches?: MatchReason[];
};

export type PublicLog = {
  id: string;
  at: string;
  author: string;
  content: string;
  kind: LogKind;
};

export type PublicOrder = {
  orderNumber: string;
  status: RepairStatus;
  repairKind: RepairKind;
  repairTarget: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  customerName: string;
  phoneMasked: string;
  deviceSummary: string;
  serialLast4?: string;
  publicLogs: PublicLog[];
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
    | { mode: 'new'; name: string; phone: string; email?: string; note?: string; employeeNumber: string; ntAccount: string };
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
