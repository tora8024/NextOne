import { STATUS_LABEL } from '../lib/labels';
import type { RepairStatus } from '../types';

export function StatusBadge({ status }: { status: RepairStatus }) {
  return <span className={`badge badge-${status}`}>{STATUS_LABEL[status]}</span>;
}
