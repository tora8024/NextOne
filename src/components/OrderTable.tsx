import { deviceLabel, formatDateTime } from '../lib/format';
import { REPAIR_KIND_LABEL } from '../lib/labels';
import type { Customer, Device, RepairOrder } from '../types';
import { StatusBadge } from './StatusBadge';
import { useRowNavigate } from './useRowNavigate';

export function OrderTable({
  orders,
  customers,
  devices,
  empty = '目前沒有符合條件的維修單。',
}: {
  orders: RepairOrder[];
  customers: Customer[];
  devices: Device[];
  empty?: string;
}) {
  const rowNavigate = useRowNavigate();
  if (orders.length === 0) return <p className="empty">{empty}</p>;

  const customerById = new Map(customers.map((customer) => [customer.id, customer]));
  const deviceById = new Map(devices.map((device) => [device.id, device]));

  return (
    <div className="table-wrap">
      <table className="data-table responsive" aria-label="維修單">
        <thead>
          <tr>
            <th scope="col">單號</th>
            <th scope="col">客戶</th>
            <th scope="col">設備</th>
            <th scope="col">送修項目</th>
            <th scope="col">狀態</th>
            <th scope="col">更新</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((order) => {
            const customer = customerById.get(order.customerId);
            const device = deviceById.get(order.deviceId);
            return (
              <tr key={order.id} {...rowNavigate(`/orders/${order.id}`, `開啟維修單 ${order.orderNumber}`)}>
                <td data-label="單號" className="mono nowrap">
                  {order.orderNumber}
                </td>
                <td data-label="客戶" className="nowrap">
                  {customer?.name ?? '未知客戶'}
                </td>
                <td data-label="設備">{device ? `${device.brand} ${device.model}` : '未知設備'}</td>
                <td data-label="送修項目">
                  <span className="tag">{REPAIR_KIND_LABEL[order.repairKind]}</span>
                  <span className="clamp">{order.repairTarget}</span>
                  {device ? <span className="muted tiny">{deviceLabel(device)}</span> : null}
                </td>
                <td data-label="狀態">
                  <StatusBadge status={order.status} />
                </td>
                <td data-label="更新" className="nowrap">
                  {formatDateTime(order.updatedAt)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
