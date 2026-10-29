import type { ActionLog, RepairOrder } from '../types';

export function sortOrders(orders: RepairOrder[]): RepairOrder[] {
  return [...orders].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
}

export type Activity = {
  orderId: string;
  orderNumber: string;
  log: ActionLog;
};

export function recentActivity(orders: RepairOrder[], limit = 6): Activity[] {
  const items: Activity[] = [];
  for (const order of orders) {
    for (const entry of order.logs) {
      items.push({ orderId: order.id, orderNumber: order.orderNumber, log: entry });
    }
  }
  items.sort((a, b) => (a.log.at < b.log.at ? 1 : a.log.at > b.log.at ? -1 : 0));
  return items.slice(0, limit);
}
