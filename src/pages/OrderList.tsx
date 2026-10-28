import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { OrderTable } from '../components/OrderTable';
import { PageHeader } from '../components/PageHeader';
import { sortOrders } from '../lib/db';
import { deviceLabel, normalizeOrderNumber, normalizePhone } from '../lib/format';
import { usePageTitle } from '../lib/hooks';
import { isRepairStatus, STATUS_LABEL, STATUS_ORDER } from '../lib/labels';
import { useStore } from '../lib/store';

export function OrderListPage() {
  const { db } = useStore();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState('');
  usePageTitle('維修單');

  const status = params.get('status') ?? '';
  const customerId = params.get('customer') ?? '';
  const deviceId = params.get('device') ?? '';

  const customers = useMemo(
    () => [...db.customers].sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant')),
    [db.customers],
  );
  const deviceOptions = db.devices.filter((device) => !customerId || device.customerId === customerId);
  const selectedDevice = db.devices.find((device) => device.id === deviceId);
  const deviceChoices =
    selectedDevice && !deviceOptions.some((device) => device.id === selectedDevice.id)
      ? [selectedDevice, ...deviceOptions]
      : deviceOptions;

  function updateParam(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key === 'customer' && value && deviceId) {
      const device = db.devices.find((item) => item.id === deviceId);
      if (device && device.customerId !== value) next.delete('device');
    }
    setParams(next, { replace: true });
  }

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    const digits = normalizePhone(q);
    const normalizedNumber = normalizeOrderNumber(q);
    return sortOrders(db.orders).filter((order) => {
      if (status === 'open' && order.status === 'completed') return false;
      if (isRepairStatus(status) && order.status !== status) return false;
      if (customerId && order.customerId !== customerId) return false;
      if (deviceId && order.deviceId !== deviceId) return false;
      if (!query) return true;
      const customer = db.customers.find((item) => item.id === order.customerId);
      const device = db.devices.find((item) => item.id === order.deviceId);
      const haystack = [order.orderNumber, order.repairTarget, order.requirements, customer?.name ?? '', customer?.phone ?? '', device?.brand ?? '', device?.model ?? '', device?.serialNumber ?? '']
        .join(' ')
        .toLowerCase();
      if (haystack.includes(query)) return true;
      if (digits.length >= 3 && customer && normalizePhone(customer.phone).includes(digits)) return true;
      if (normalizedNumber.length >= 3 && normalizeOrderNumber(order.orderNumber).includes(normalizedNumber)) return true;
      return false;
    });
  }, [db, q, status, customerId, deviceId]);

  const hasFilter = Boolean(q || status || customerId || deviceId);

  return (
    <>
      <PageHeader
        kicker="追蹤"
        title="維修單"
        lede="依狀態、客戶或設備查看進度，也能用單號、電話或送修內容搜尋。"
        actions={
          <Link className="btn btn-primary" to="/orders/new">
            建立維修單
          </Link>
        }
      />
      <div className="toolbar">
        <label className="field">
          <span>搜尋</span>
          <input value={q} onChange={(event) => setQ(event.target.value)} placeholder="單號、客戶、電話、型號或送修內容" />
        </label>
        <label className="field">
          <span>狀態</span>
          <select value={status} onChange={(event) => updateParam('status', event.target.value)}>
            <option value="">全部狀態</option>
            <option value="open">未結案</option>
            {STATUS_ORDER.map((item) => (
              <option key={item} value={item}>
                {STATUS_LABEL[item]}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>客戶</span>
          <select value={customerId} onChange={(event) => updateParam('customer', event.target.value)}>
            <option value="">全部客戶</option>
            {customers.map((customer) => (
              <option key={customer.id} value={customer.id}>
                {customer.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>設備</span>
          <select value={deviceId} onChange={(event) => updateParam('device', event.target.value)}>
            <option value="">全部設備</option>
            {deviceChoices.map((device) => (
              <option key={device.id} value={device.id}>
                {deviceLabel(device)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <section className="panel">
        <div className="section-head">
          <p className="result-count">共 {filtered.length} 張</p>
          {hasFilter ? (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                setQ('');
                setParams(new URLSearchParams(), { replace: true });
              }}
            >
              清除篩選
            </button>
          ) : null}
        </div>
        <OrderTable orders={filtered} customers={db.customers} devices={db.devices} />
      </section>
    </>
  );
}
